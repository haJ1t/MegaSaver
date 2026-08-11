import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitState } from "./snapshot.js";

const execFileAsync = promisify(execFile);

export function parsePorcelainZ(stdout: Buffer): {
  staged: GitState["staged"];
  unstaged: GitState["unstaged"];
  untracked: string[];
} {
  const staged: GitState["staged"] = [];
  const unstaged: GitState["unstaged"] = [];
  const untracked: string[] = [];
  if (stdout.length === 0) return { staged, unstaged, untracked };
  const entries = stdout.toString("utf8").split("\0");
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.length < 2) continue;
    const x = entry[0] ?? " ";
    const y = entry[1] ?? " ";
    let path = entry.slice(3);
    // Handle renames: "R  old\0new" -> we get two entries; second is dest
    // For -z, rename shows "R100\0old\0new\0" — we simplify: last token is path
    if (path.includes("\0")) path = path.split("\0").pop() ?? path;
    const status = `${x}${y}`.trim() || "??";
    if (x !== " " && x !== "?" && x !== "!") {
      staged.push({ path, status: x, hash: "" });
    }
    if (y !== " " && y !== "?" && y !== "!") {
      unstaged.push({ path, status: y, hash: "" });
    }
    if (x === "?" && y === "?") {
      untracked.push(path);
    }
  }
  return { staged, unstaged, untracked };
}

export async function captureGitState(
  gitRoot: string,
  opts?: { timeoutMs?: number },
): Promise<GitState> {
  const timeout = opts?.timeoutMs ?? 2000;
  try {
    const [headRes, branchRes, statusRes] = await Promise.all([
      execFileAsync("git", ["-C", gitRoot, "rev-parse", "HEAD"], { timeout }).catch(
        () => ({ stdout: "" }),
      ),
      execFileAsync("git", ["-C", gitRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
        timeout,
      }).catch(() => ({ stdout: "" })),
      execFileAsync("git", ["-C", gitRoot, "status", "--porcelain=v1", "-uall", "-z"], {
        timeout,
        encoding: "buffer",
        maxBuffer: 10 * 1024 * 1024,
      } as never).catch(() => ({ stdout: Buffer.alloc(0) })),
    ]);
    const headOid = (headRes as { stdout: string }).stdout.trim() || null;
    let branch = (branchRes as { stdout: string }).stdout.trim() || null;
    if (branch === "HEAD") branch = null;
    const statusBuf = (statusRes as { stdout: Buffer }).stdout as Buffer;
    const { staged, unstaged, untracked } = parsePorcelainZ(
      Buffer.isBuffer(statusBuf) ? statusBuf : Buffer.from(String(statusBuf)),
    );
    return {
      available: true,
      headOid,
      branch,
      staged,
      unstaged,
      untracked,
    };
  } catch (error) {
    return {
      available: false,
      headOid: null,
      branch: null,
      staged: [],
      unstaged: [],
      untracked: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
