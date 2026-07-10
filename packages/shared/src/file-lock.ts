import { closeSync, openSync, rmSync, statSync } from "node:fs";

export type FileLockOptions = { deadlineMs: number; staleMs: number };

// Cross-process advisory lock via wx-create. Best-effort by design: returns
// true when fn ran (lock acquired), false when the deadline passed while a
// FRESH lock was held (callers skip their write). A lock whose mtime is older
// than staleMs is a dead holder's residue — it is removed and the acquire
// retried, so a crashed writer can never freeze its callers forever (E25).
// fn errors propagate AFTER the lock file is released. The caller ensures the
// lock's parent directory exists.
export function withFileLock(lockPath: string, opts: FileLockOptions, fn: () => void): boolean {
  const deadline = Date.now() + opts.deadlineMs;
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      break;
    } catch {
      let observedMtime = Number.NaN;
      try {
        observedMtime = statSync(lockPath).mtimeMs;
      } catch {
        // lock vanished between wx and stat — retry within the deadline
      }
      if (observedMtime < Date.now() - opts.staleMs) {
        // Stale residue of a dead holder. Re-stat immediately before removing
        // and steal only if the mtime is byte-for-byte the one we judged
        // stale. If it changed (a live holder recreated it) or is already
        // gone, do NOT rm — removing a FRESH lock lets two callers run fn()
        // at once (double-steal / lost update). Let the atomic wx race decide.
        try {
          if (statSync(lockPath).mtimeMs === observedMtime) {
            rmSync(lockPath, { force: true });
          }
        } catch {
          // recreated or removed concurrently — next wx attempt races normally
        }
        continue;
      }
      if (Date.now() >= deadline) return false;
    }
  }
  try {
    fn();
    return true;
  } finally {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // best-effort release; a leftover lock is stolen as stale after staleMs
    }
  }
}
