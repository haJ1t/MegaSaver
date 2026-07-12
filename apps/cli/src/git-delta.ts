import { execFileSync } from "node:child_process";
import type { GitDelta } from "@megasaver/core";

export type ExecGit = (args: string[], cwd: string) => string;

// timeout so a stuck git (index.lock, slow FS) can't stall session start; tryGit catches the throw
const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
  });

const FALLBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function tryGit(exec: ExecGit, args: string[], cwd: string): string | null {
  try {
    return exec(args, cwd);
  } catch {
    return null;
  }
}

function defaultBranch(exec: ExecGit, cwd: string): string | null {
  const head = tryGit(exec, ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (head !== null) {
    const name = head.trim().split("/").pop();
    if (name !== undefined && name.length > 0) return `origin/${name}`;
  }
  for (const candidate of ["main", "master"]) {
    if (tryGit(exec, ["rev-parse", "--verify", candidate], cwd) !== null) return candidate;
  }
  return null;
}

function parseNumstat(out: string): GitDelta["changedFiles"] {
  const files: GitDelta["changedFiles"] = [];
  for (const line of out.split("\n")) {
    const [add, del, path] = line.split("\t");
    if (path === undefined || path.trim() === "") continue;
    const churn = (Number.parseInt(add ?? "0", 10) || 0) + (Number.parseInt(del ?? "0", 10) || 0);
    files.push({ path: path.trim(), churn });
  }
  return files;
}

function parseNameOnly(out: string): GitDelta["changedFiles"] {
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    const path = line.trim();
    if (path === "" || path.includes("\t")) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([path, churn]) => ({ path, churn }));
}

// Spec fallback chain: merge-base diff on a feature branch; on the default
// branch / detached HEAD / empty diff, fall back to log --name-only since the
// last visit — otherwise the branch-aware failed-attempts section is a
// permanent no-op for the common single-branch workflow.
export function gatherGitDelta(
  cwd: string,
  lastSeenAt: string | null,
  execGit: ExecGit = defaultExecGit,
  nowIso?: string,
): GitDelta | null {
  const branchRaw = tryGit(execGit, ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (branchRaw === null) return null;
  const branch = branchRaw.trim();

  const nowMs = nowIso === undefined ? Date.parse(new Date().toISOString()) : Date.parse(nowIso);
  const since = lastSeenAt ?? new Date(nowMs - FALLBACK_WINDOW_MS).toISOString();

  const logOut =
    tryGit(execGit, ["log", `--since=${since}`, "--format=%h%x09%s%x09%cI"], cwd) ?? "";
  const commits: GitDelta["commits"] = [];
  for (const line of logOut.split("\n")) {
    const [sha, subject, date] = line.split("\t");
    if (sha === undefined || sha.trim() === "" || subject === undefined || date === undefined) {
      continue;
    }
    commits.push({ sha: sha.trim(), subject: subject.trim(), date: date.trim() });
  }

  const def = defaultBranch(execGit, cwd);
  let changedFiles: GitDelta["changedFiles"] = [];
  const onFeatureBranch =
    def !== null && branch !== "HEAD" && branch !== def && `origin/${branch}` !== def;
  if (onFeatureBranch) {
    const base = tryGit(execGit, ["merge-base", def, "HEAD"], cwd)?.trim();
    if (base !== undefined && base.length > 0) {
      const out = tryGit(execGit, ["diff", "--numstat", `${base}..HEAD`], cwd);
      if (out !== null) changedFiles = parseNumstat(out);
    }
  }
  if (changedFiles.length === 0) {
    const out = tryGit(execGit, ["log", "--name-only", `--since=${since}`, "--format="], cwd);
    if (out !== null) changedFiles = parseNameOnly(out);
  }

  return { commits, changedFiles, branch };
}
