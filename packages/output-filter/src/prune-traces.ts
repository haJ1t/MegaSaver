import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// Traces are the only always-on new disk (recording is on by default —
// rank.ts seamTraceEnabledByEnv). This cap bounds it: keep the most recently
// modified sessions' trace dirs, drop the rest. No env override — YAGNI.
export const MAX_TRACE_SESSIONS = 20;

const TRACE_DIR_SUFFIX = "-traces";

// Best-effort retention prune for `stats/<projectId>/<sessionId>-traces/` dirs.
// It ONLY ever removes directory entries whose name ends with `-traces` inside
// `<storeRoot>/stats/<projectId>/`; sibling token-saver stat files
// (`.events.jsonl`, `.json`) that the GUI reads are never touched. A missing or
// unreadable stats dir is a no-op, and any fs error is swallowed — pruning is
// housekeeping, never allowed to throw into the response path.
export function pruneTraceSessions(
  storeRoot: string,
  projectId: string,
  maxSessions = MAX_TRACE_SESSIONS,
): void {
  const projectStatsDir = join(storeRoot, "stats", projectId);

  let traceDirs: { path: string; mtimeMs: number }[];
  try {
    traceDirs = readdirSync(projectStatsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(TRACE_DIR_SUFFIX))
      .map((entry) => {
        const path = join(projectStatsDir, entry.name);
        return { path, mtimeMs: statSync(path).mtimeMs };
      });
  } catch {
    return; // missing / unreadable stats dir → nothing to prune
  }

  if (traceDirs.length <= maxSessions) return;

  traceDirs.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  for (const stale of traceDirs.slice(maxSessions)) {
    try {
      rmSync(stale.path, { recursive: true, force: true });
    } catch {
      // best-effort: a single un-removable dir must not abort the rest
    }
  }
}
