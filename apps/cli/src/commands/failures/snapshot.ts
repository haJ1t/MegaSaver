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
    const events = readOverlayEvents({ root: storeRoot }, workspaceKey, sid);
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
  const events: readonly OverlayTokenSaverEvent[] =
    liveSessionId === undefined
      ? []
      : readOverlayEvents({ root: input.storeRoot }, workspaceKey, liveSessionId);
  let readIndex: Record<string, ReadIndexEntry> | undefined;
  if (liveSessionId !== undefined) {
    const sessionDir = join(input.storeRoot, "content", workspaceKey, liveSessionId);
    try {
      readFileSync(join(sessionDir, READ_INDEX_FILENAME));
      readIndex = loadReadIndex(sessionDir);
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
