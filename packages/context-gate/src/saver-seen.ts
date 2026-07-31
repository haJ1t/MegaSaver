import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";

// P1 first-sight ledger: which tool outputs THIS session has already seen.
// Repeats pass through because the net-cost effect of rewriting previously-
// seen content is UNMEASURED (the cache-churn mechanism once cited here was
// retracted — wiki/syntheses/saver-cache-churn, CORRECTION 2026-07-30);
// first-sight-only is the conservative choice while A4 is open. Fail-open: any
// read anomaly reports "not seen" (worst case: one redundant compression,
// never a broken tool call). sessionId comes from the hook payload, so files
// are naturally session-scoped and small; a 500-hash FIFO cap bounds them.

const SEEN_CAP = 500;
const SEEN_LOCK_OPTIONS = { deadlineMs: 50, staleMs: 5000 };

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
  const path = seenPath(storeRoot, workspaceKey, sessionId);
  if (!existsSync(path)) return false;
  let seen = false;
  withFileLock(`${path}.lock`, SEEN_LOCK_OPTIONS, () => {
    seen = readHashes(path).includes(hash);
  });
  return seen;
}

export function recordSeenOutput(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  hash: string,
): void {
  const path = seenPath(storeRoot, workspaceKey, sessionId);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // Parallel tool calls in one turn each spawn their own saver hook process and
  // share this session's ledger, so an unlocked read-modify-write loses whichever
  // hash renames last. Same stale-aware lock the identical shape uses in
  // stats/store.ts (E26): deadlineMs 50 (a hook must not stall the agent),
  // staleMs 5000 (a dead writer's lock is stolen). A skipped write is the
  // pre-existing fail-open — one redundant compression, never a broken call.
  withFileLock(`${path}.lock`, SEEN_LOCK_OPTIONS, () => {
    const hashes = readHashes(path);
    if (!hashes.includes(hash)) hashes.push(hash);
    const capped = hashes.slice(-SEEN_CAP);
    try {
      writeFileSync(path, JSON.stringify({ version: 1, hashes: capped }));
    } catch {
      // Auxiliary cache writes may fail open; the next hook recompresses once.
    }
  });
}
