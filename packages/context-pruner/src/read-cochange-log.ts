import { execFileSync } from "node:child_process";

// The I/O edge for the co-change signal: shell out `git log --numstat` once per
// repo and hand the raw text to scoreBlocks' coChangeLog. Kept OUT of the scored
// core (score.ts stays pure) so the engine is testable without a git checkout.
//
// Returns "" — a no-op for the scorer — on any failure (not a git repo, git
// missing, empty history). The scorer treats "" exactly like an absent log.

// Bound the walk: deep histories make the numstat parse O(commits) for little
// extra signal, and large outputs are wasteful to pipe back. Last N commits is
// where co-change recency lives anyway.
const MAX_COMMITS = 1000;

// Per-cwd memo: the same workspace is scored repeatedly across tool calls in one
// process; shelling out git on every pack build is the dominant cost otherwise.
// ponytail: never invalidated within a process — a fresh commit mid-session
// won't show until restart. Acceptable: ranking, not correctness, and the
// process is short-lived. Drop the cache (or add a TTL) if that ever bites.
const cache = new Map<string, string>();

export function readCoChangeLog(cwd: string): string {
  const cached = cache.get(cwd);
  if (cached !== undefined) return cached;

  let log = "";
  try {
    log = execFileSync("git", ["log", `--max-count=${MAX_COMMITS}`, "--numstat", "--format=%n"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    log = "";
  }

  cache.set(cwd, log);
  return log;
}
