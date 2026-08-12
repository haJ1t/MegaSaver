import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { redact } from "@megasaver/policy";
import { postEvent } from "./events.js";
import { meshPaths } from "./paths.js";
import { listPeers } from "./presence.js";
import { atomicWriteFileSync, quarantineFileSync, safeJsonParse } from "./store.js";
import {
  type HandoffOfferPointer,
  type MeshEvent,
  type MeshEventKind,
  meshEventSchema,
} from "./types.js";

const MAX_TEXT = 4000;

function boundedRedacted(text: string): string {
  const { redacted } = redact(text);
  if (redacted.length > MAX_TEXT) return redacted.slice(0, MAX_TEXT);
  return redacted;
}

export function sendMessage(
  storeRoot: string,
  input: {
    from: string;
    to: string | undefined;
    kind: MeshEventKind;
    text: string;
    offer?: HandoffOfferPointer;
    workspaceKey?: string;
  },
): MeshEvent {
  const redactedText = boundedRedacted(input.text);
  const evt: MeshEvent = {
    id: randomUUID(),
    kind: input.kind,
    from: input.from,
    text: redactedText,
    createdAt: new Date().toISOString(),
    ...(input.to !== undefined ? { to: input.to } : {}),
    ...(input.offer !== undefined ? { offer: input.offer } : {}),
  };
  // validate strictly
  const parsed = meshEventSchema.parse(evt);

  // also append bus event (always)
  postEvent(storeRoot, parsed);

  const { inboxDir } = meshPaths(storeRoot);
  // ensure inboxDir exists with 0700 even when broadcasting to empty set (so drainInbox has dir to read)
  // Note: atomicWrite will mkdir parent as needed, but we ensure base inboxDir perms via mkdir+chmod.
  // For single-target, atomicWrite will create per-recipient subdir.

  let recipients: string[];
  if (input.to !== undefined) {
    recipients = [input.to];
  } else {
    // broadcast to all live peers
    const peers = listPeers(storeRoot, { all: true });
    // exclude sender to avoid self-delivery
    recipients = peers.map((p) => p.liveSessionId).filter((id) => id !== input.from);
  }

  for (const recipient of recipients) {
    // guard unsafe segment to avoid path traversal; skip invalid recipients
    // Use same SAFE_SEGMENT logic as presence: if invalid, skip rather than write arbitrary path
    // This also prevents draining arbitrary dirs.
    // We still consider the bus event posted, only inbox fanout skips.
    if (recipient.length === 0 || recipient.length > 128) continue;
    // quick segment check without importing regex to avoid circular; rely on atomicWrite guard for symlink
    // but we still skip if contains path separators or null bytes
    if (recipient.includes("/") || recipient.includes("\\") || recipient.includes("\0")) continue;
    const dir = join(inboxDir, recipient);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        chmodSync(dir, 0o700);
      } catch {}
    } catch {}
    const filePath = join(dir, `${parsed.id}.json`);
    try {
      atomicWriteFileSync(filePath, `${JSON.stringify(parsed)}\n`);
    } catch {}
  }

  // Ensure inbox base dir exists for future drains (best effort)
  try {
    mkdirSync(inboxDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(inboxDir, 0o700);
    } catch {}
  } catch {}

  return parsed;
}

export function drainInbox(storeRoot: string, liveSessionId: string): MeshEvent[] {
  const { inboxDir } = meshPaths(storeRoot);
  const dir = join(inboxDir, liveSessionId);
  if (!existsSync(dir)) return [];
  // guard path traversal
  if (liveSessionId.includes("/") || liveSessionId.includes("\\") || liveSessionId.includes("\0"))
    return [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const events: MeshEvent[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    // skip hidden claim temp files from concurrent drains
    if (file.startsWith(".claim-")) continue;
    const filePath = join(dir, file);
    const claimPath = join(dir, `.claim-${randomUUID()}.tmp`);
    let claimed = false;
    try {
      renameSync(filePath, claimPath);
      claimed = true;
    } catch {
      continue;
    }
    if (!claimed) continue;
    let raw: string;
    try {
      raw = readFileSync(claimPath, "utf8");
    } catch {
      try {
        rmSync(claimPath, { force: true });
      } catch {}
      continue;
    }
    if (raw.trim() === "") {
      quarantineFileSync(claimPath, storeRoot);
      continue;
    }
    const parsedJson = safeJsonParse(raw);
    if (parsedJson === undefined) {
      quarantineFileSync(claimPath, storeRoot);
      continue;
    }
    const result = meshEventSchema.safeParse(parsedJson);
    if (!result.success) {
      quarantineFileSync(claimPath, storeRoot);
      continue;
    }
    const evt = result.data;
    try {
      rmSync(claimPath, { force: true });
    } catch {}
    events.push(evt);
  }
  // oldest-first by createdAt (and id tie-break for stability)
  events.sort((a, b) => {
    const da = Date.parse(a.createdAt);
    const db = Date.parse(b.createdAt);
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });
  return events;
}
