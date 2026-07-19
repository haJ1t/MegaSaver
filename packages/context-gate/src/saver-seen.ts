import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// P1 first-sight ledger: which tool outputs THIS session has already seen.
// A seen output is already in the conversation (and likely in the client's
// prompt cache) — rewriting it would invalidate that cache. Fail-open: any
// read anomaly reports "not seen" (worst case: one redundant compression,
// never a broken tool call). sessionId comes from the hook payload, so files
// are naturally session-scoped and small; a 500-hash FIFO cap bounds them.

const SEEN_CAP = 500;

const seenSchema = z.object({ version: z.literal(1), hashes: z.array(z.string()) });

function seenPath(storeRoot: string, workspaceKey: string, sessionId: string): string {
  return join(storeRoot, "stats", workspaceKey, "saver-seen", `${sessionId}.json`);
}

export function hashToolOutput(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function readHashes(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = seenSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data.hashes : [];
  } catch {
    return [];
  }
}

export function hasSeenOutput(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  hash: string,
): boolean {
  return readHashes(seenPath(storeRoot, workspaceKey, sessionId)).includes(hash);
}

export function recordSeenOutput(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  hash: string,
): void {
  const path = seenPath(storeRoot, workspaceKey, sessionId);
  const hashes = readHashes(path);
  if (!hashes.includes(hash)) hashes.push(hash);
  const capped = hashes.slice(-SEEN_CAP);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify({ version: 1, hashes: capped }));
  renameSync(tmp, path);
}
