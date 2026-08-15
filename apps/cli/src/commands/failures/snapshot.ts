import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { READ_INDEX_FILENAME } from "@megasaver/content-store";
import {
  type OverlayTokenSaverEvent,
  type ReadIndexEntry,
  loadReadIndex,
  readOverlayEvents,
} from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import type { ScannedRefs } from "./scan-refs.js";
import { scanRefs } from "./scan-refs.js";

export type FailureSnapshot = {
  workspaceKey: string;
  liveSessionId: string | undefined;
  events: readonly OverlayTokenSaverEvent[];
  chunkSets: readonly []; // v1 hardcode — compaction-guard unshipped (spec Decision 8 amendment)
  readIndex: Record<string, ReadIndexEntry> | undefined; // undefined = file absent (no-signal leg)
  capsule: undefined; // v1 hardcode — compaction-guard unshipped
  refs: ScannedRefs | undefined; // undefined = no input text
};
export function pickNewestSessionId(storeRoot: string, workspaceKey: string): string | undefined {
  let dir: string[];
  try {
    dir = readdirSync(join(storeRoot, "stats", workspaceKey));
  } catch {
    return undefined;
  }
  let newest: { id: string; createdAt: string } | undefined;
  for (const name of dir) {
    if (!name.endsWith(".events.jsonl")) continue;
    const sid = name.slice(0, -".events.jsonl".length);
    // Store anomalies are data, not crashes: an unreadable session file
    // (EACCES, vanished mid-read) skips that candidate — the session pick
    // never throws (spec Error handling).
    let events: readonly OverlayTokenSaverEvent[];
    try {
      events = readOverlayEvents({ root: storeRoot }, workspaceKey, sid);
    } catch {
      continue;
    }
    const last = events[events.length - 1];
    if (last === undefined) continue;
    if (newest === undefined || last.createdAt > newest.createdAt) {
      newest = { id: sid, createdAt: last.createdAt };
    } else if (last.createdAt === newest.createdAt && sid > newest.id) {
      // createdAt ties break by lexicographically larger session id, for
      // determinism (spec Task 3 ASSUMPTION).
      newest = { id: sid, createdAt: last.createdAt };
    }
  }
  return newest?.id;
}

export async function loadFailureSnapshot(input: {
  storeRoot: string;
  cwd: string;
  liveSessionId?: string;
  inputText?: string;
}): Promise<FailureSnapshot> {
  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const liveSessionId = input.liveSessionId ?? pickNewestSessionId(input.storeRoot, workspaceKey);
  let events: readonly OverlayTokenSaverEvent[] = [];
  if (liveSessionId !== undefined) {
    try {
      events = readOverlayEvents({ root: input.storeRoot }, workspaceKey, liveSessionId);
    } catch {
      events = []; // unreadable store degrades to no events, never a crash
    }
  }
  let readIndex: Record<string, ReadIndexEntry> | undefined;
  if (liveSessionId !== undefined) {
    const sessionDir = join(input.storeRoot, "content", workspaceKey, liveSessionId);
    const indexPath = join(sessionDir, READ_INDEX_FILENAME);
    try {
      // Parse-validate BEFORE handing over: loadReadIndex degrades BOTH
      // "absent" and "corrupt JSON" to {} — but a corrupt index must read as
      // no-signal (the capture leg is unreadable), never as a confident empty
      // index that turns every path ref into a phantom finding.
      const raw = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        readIndex = undefined;
      } else {
        readIndex = loadReadIndex(sessionDir);
      }
    } catch {
      readIndex = undefined;
    }
  }
  return {
    workspaceKey,
    liveSessionId,
    events,
    chunkSets: [],
    readIndex,
    capsule: undefined,
    refs: input.inputText === undefined ? undefined : scanRefs(input.inputText),
  };
}
