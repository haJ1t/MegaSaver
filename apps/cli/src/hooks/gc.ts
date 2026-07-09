import { statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pruneOlderThan } from "@megasaver/content-store";

export const OVERLAY_RETENTION_MS = 30 * 86_400_000;
export const GC_INTERVAL_MS = 86_400_000;

export type GcDeps = {
  now?: () => number;
  prune?: typeof pruneOlderThan;
};

// Throttled, best-effort content-store GC (C14). The marker is touched BEFORE
// pruning so a hook arriving AFTER the touch skips the walk. A simultaneous
// check-then-claim race (two hooks in the statSync→write window) can still both
// prune the same day — benign: pruneOlderThan is force/ENOENT-tolerant and any
// cross-process fs race is swallowed here, so the worst case is redundant work.
// Every failure path returns false without throwing — housekeeping, not
// correctness (pruneTraceSessions precedent). True only when a prune completed.
export async function maybeRunOverlayGc(storeRoot: string, deps: GcDeps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const prune = deps.prune ?? pruneOlderThan;
  const marker = join(storeRoot, "content", ".last-gc");
  try {
    const mtime = statSync(marker).mtimeMs;
    if (now() - mtime < GC_INTERVAL_MS) return false;
  } catch {
    // Marker absent: claim it below. If content/ itself is absent the write
    // throws and there is nothing to prune anyway (returns false below).
  }
  try {
    const stamp = new Date(now());
    writeFileSync(marker, "");
    utimesSync(marker, stamp, stamp); // stamp with the injected clock, not wall time
  } catch {
    return false;
  }
  try {
    await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
    return true;
  } catch {
    return false;
  }
}
