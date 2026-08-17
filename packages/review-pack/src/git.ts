import { execFileSync } from "node:child_process";
import { ReviewPackError } from "./errors.js";

export type ExecGit = (args: string[], cwd: string) => string;

export const defaultExecGit: ExecGit = (args: string[], cwd: string): string => {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
  });
};

export type LineRange = { start: number; end: number };
export type RangeInfo = { baseSha: string; headSha: string; label: string };
export type CommitInfo = { sha: string; subject: string; committedAt: string };
export type ChangedFile = { path: string; status: "A" | "D" | "M" | "R" };

export function repoTopLevel(cwd: string, execGit: ExecGit = defaultExecGit): string | null {
  try {
    const out = execGit(["rev-parse", "--show-toplevel"], cwd);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function assertCleanTree(repoRoot: string, execGit: ExecGit = defaultExecGit): void {
  let out: string;
  try {
    out = execGit(["status", "--porcelain", "-z"], repoRoot);
  } catch (err) {
    throw new ReviewPackError("git_unavailable", "git is unavailable or directory is not a git repository", {
      cause: err,
    });
  }
  if (out.trim().length > 0) {
    throw new ReviewPackError(
      "dirty_worktree",
      "working tree is dirty (has unstaged or uncommitted changes); commit or stash before creating review pack",
    );
  }
}

function resolveDefaultBranch(repoRoot: string, execGit: ExecGit): string | null {
  try {
    const ref = execGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoRoot).trim();
    if (ref.startsWith("refs/remotes/origin/")) {
      const branch = ref.slice("refs/remotes/origin/".length);
      execGit(["rev-parse", "--verify", branch], repoRoot);
      return branch;
    }
  } catch {
    // try fallback branches
  }
  for (const branch of ["main", "master"]) {
    try {
      execGit(["rev-parse", "--verify", branch], repoRoot);
      return branch;
    } catch {
      // try next
    }
  }
  return null;
}

export function resolveRange(
  repoRoot: string,
  range: string | undefined,
  execGit: ExecGit = defaultExecGit,
): RangeInfo {
  let base: string;
  let head: string;
  let label: string;

  if (range !== undefined) {
    const parts = range.split("..");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ReviewPackError("bad_range", `invalid commit range format "${range}" (expected <base>..<head>)`);
    }
    base = parts[0];
    head = parts[1];
    label = range;
  } else {
    const defaultBranch = resolveDefaultBranch(repoRoot, execGit);
    if (!defaultBranch) {
      throw new ReviewPackError("bad_range", "unable to determine default branch (main/master not found)");
    }
    try {
      const mergeBase = execGit(["merge-base", defaultBranch, "HEAD"], repoRoot).trim();
      base = mergeBase;
      head = "HEAD";
      label = `${defaultBranch}..HEAD`;
    } catch (err) {
      throw new ReviewPackError("bad_range", `failed to compute merge-base with default branch "${defaultBranch}"`, {
        cause: err,
      });
    }
  }

  let baseSha: string;
  let headSha: string;
  try {
    baseSha = execGit(["rev-parse", "--verify", base], repoRoot).trim();
    headSha = execGit(["rev-parse", "--verify", head], repoRoot).trim();
  } catch (err) {
    throw new ReviewPackError("bad_range", `invalid or unresolvable commit range "${label}"`, { cause: err });
  }

  return { baseSha, headSha, label };
}

export function listCommits(
  repoRoot: string,
  r: RangeInfo,
  execGit: ExecGit = defaultExecGit,
): CommitInfo[] {
  let out: string;
  try {
    out = execGit(["log", "--format=%H%x09%s%x09%cI", `${r.baseSha}..${r.headSha}`], repoRoot);
  } catch {
    return [];
  }
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const [sha = "", subject = "", committedAt = ""] = line.split("\t");
    return { sha, subject, committedAt };
  });
}

export function listChangedFiles(
  repoRoot: string,
  r: RangeInfo,
  execGit: ExecGit = defaultExecGit,
): ChangedFile[] {
  let out: string;
  try {
    out = execGit(["diff", "--name-status", "-z", `${r.baseSha}..${r.headSha}`], repoRoot);
  } catch {
    return [];
  }
  const tokens = out.split("\0").filter((t) => t.length > 0);
  const changed: ChangedFile[] = [];
  let i = 0;
  while (i < tokens.length) {
    const statusRaw = tokens[i] ?? "";
    const status = statusRaw.slice(0, 1) as "A" | "D" | "M" | "R";
    if (status === "R") {
      // Renames carry oldPath and newPath
      const newPath = tokens[i + 2] ?? "";
      changed.push({ path: newPath, status: "R" });
      i += 3;
    } else {
      const path = tokens[i + 1] ?? "";
      changed.push({ path, status });
      i += 2;
    }
  }
  return changed;
}

export function unifiedDiff(
  repoRoot: string,
  r: RangeInfo,
  execGit: ExecGit = defaultExecGit,
): string {
  try {
    return execGit(["diff", `${r.baseSha}..${r.headSha}`], repoRoot);
  } catch {
    return "";
  }
}

export function fileAtHead(
  repoRoot: string,
  headSha: string,
  path: string,
  execGit: ExecGit = defaultExecGit,
): string | null {
  try {
    return execGit(["show", `${headSha}:${path}`], repoRoot);
  } catch {
    return null;
  }
}

export function changedLineRanges(
  repoRoot: string,
  r: RangeInfo,
  path: string,
  execGit: ExecGit = defaultExecGit,
): LineRange[] {
  let diff: string;
  try {
    diff = execGit(["diff", "--unified=0", `${r.baseSha}..${r.headSha}`, "--", path], repoRoot);
  } catch {
    return [];
  }
  const ranges: LineRange[] = [];
  const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null = hunkHeader.exec(diff);
  while (match !== null) {
    const c = Number.parseInt(match[3] ?? "0", 10);
    const d = match[4] !== undefined ? Number.parseInt(match[4], 10) : 1;
    if (d > 0) {
      ranges.push({ start: c, end: c + d - 1 });
    }
    match = hunkHeader.exec(diff);
  }
  return ranges;
}
