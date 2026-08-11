import { redact } from "@megasaver/policy";
import { z } from "zod";

export const PREFLIGHT_VERSION = 1 as const;

export const preflightSnapshotSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.string().regex(/^preflight-\d+-[a-z0-9]{6}$/),
    createdAt: z.string().datetime({ offset: true }),
    workspaceKey: z.string().min(1),
    sessionId: z.string().optional(),
    projectId: z.string().optional(),
    label: z.string().optional(),
    git: z
      .object({
        available: z.boolean(),
        headOid: z.string().nullable(),
        branch: z.string().nullable(),
        staged: z.array(z.object({ path: z.string(), status: z.string(), hash: z.string() })),
        unstaged: z.array(z.object({ path: z.string(), status: z.string(), hash: z.string() })),
        untracked: z.array(z.string()),
        reason: z.string().optional(),
      })
      .strict(),
    counters: z
      .object({
        staged: z.number().int().nonnegative(),
        unstaged: z.number().int().nonnegative(),
        untracked: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PreflightSnapshot = z.infer<typeof preflightSnapshotSchema>;

export type GitState = {
  available: boolean;
  headOid: string | null;
  branch: string | null;
  staged: { path: string; status: string; hash: string }[];
  unstaged: { path: string; status: string; hash: string }[];
  untracked: string[];
  reason?: string;
};

export function buildPreflightSnapshot(input: {
  git: GitState;
  workspaceKey: string;
  sessionId?: string;
  projectId?: string;
  label?: string;
  now: () => number;
}): PreflightSnapshot {
  const nowMs = input.now();
  const snapshotId = `preflight-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
  const git = input.git;
  const redactPath = (p: string) => redact(p).redacted;
  const staged = [...git.staged]
    .map((s) => ({ ...s, path: redactPath(s.path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const unstaged = [...git.unstaged]
    .map((s) => ({ ...s, path: redactPath(s.path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const untracked = [...git.untracked].map(redactPath).sort();
  return {
    version: 1,
    snapshotId,
    createdAt: new Date(nowMs).toISOString(),
    workspaceKey: input.workspaceKey,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.label ? { label: input.label } : {}),
    git: {
      available: git.available,
      headOid: git.headOid,
      branch: git.branch,
      staged,
      unstaged,
      untracked,
      ...(git.reason ? { reason: git.reason } : {}),
    },
    counters: {
      staged: staged.length,
      unstaged: unstaged.length,
      untracked: untracked.length,
    },
  };
}

export type PreflightDiff = {
  snapshotA: string;
  snapshotB: string;
  createdAtA: string;
  createdAtB: string;
  stagedAdded: string[];
  stagedRemoved: string[];
  unstagedAdded: string[];
  unstagedRemoved: string[];
  untrackedAdded: string[];
  untrackedRemoved: string[];
  headChanged: boolean;
  branchChanged: boolean;
};

export function comparePreflightSnapshots(
  a: PreflightSnapshot,
  b: PreflightSnapshot,
): PreflightDiff {
  const set = (arr: { path: string }[] | string[]) =>
    new Set(arr.map((x) => (typeof x === "string" ? x : (x as { path: string }).path)));
  const aStaged = set(a.git.staged);
  const bStaged = set(b.git.staged);
  const aUnstaged = set(a.git.unstaged);
  const bUnstaged = set(b.git.unstaged);
  const aUntracked = new Set(a.git.untracked);
  const bUntracked = new Set(b.git.untracked);

  const diff = (sa: Set<string>, sb: Set<string>) => ({
    added: [...sb].filter((x) => !sa.has(x)).sort(),
    removed: [...sa].filter((x) => !sb.has(x)).sort(),
  });

  const staged = diff(aStaged, bStaged);
  const unstaged = diff(aUnstaged, bUnstaged);
  const untracked = diff(aUntracked, bUntracked);

  return {
    snapshotA: a.snapshotId,
    snapshotB: b.snapshotId,
    createdAtA: a.createdAt,
    createdAtB: b.createdAt,
    stagedAdded: staged.added,
    stagedRemoved: staged.removed,
    unstagedAdded: unstaged.added,
    unstagedRemoved: unstaged.removed,
    untrackedAdded: untracked.added,
    untrackedRemoved: untracked.removed,
    headChanged: a.git.headOid !== b.git.headOid,
    branchChanged: a.git.branch !== b.git.branch,
  };
}

export function renderPreflightDiff(
  diff: PreflightDiff,
  opts?: { maxPerSection?: number },
): string {
  const max = opts?.maxPerSection ?? 200;
  const lines: string[] = [];
  lines.push(`# Preflight diff: ${diff.snapshotA} -> ${diff.snapshotB}`);
  lines.push(`A: ${diff.createdAtA}  B: ${diff.createdAtB}`);
  if (diff.headChanged) lines.push("HEAD changed");
  if (diff.branchChanged) lines.push("branch changed");
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title} (${items.length})`);
    const slice = items.slice(0, max);
    for (const p of slice) lines.push(`  ${p}`);
    if (items.length > max) lines.push(`  ... +${items.length - max} more`);
  };
  section("staged added", diff.stagedAdded);
  section("staged removed", diff.stagedRemoved);
  section("unstaged added", diff.unstagedAdded);
  section("unstaged removed", diff.unstagedRemoved);
  section("untracked added", diff.untrackedAdded);
  section("untracked removed", diff.untrackedRemoved);
  if (lines.length === 3 && !diff.headChanged && !diff.branchChanged) {
    lines.push("(no changes)");
  }
  return lines.join("\n");
}

export function parsePreflightId(filename: string): string | null {
  const m = filename.match(/^(preflight-\d+-[a-z0-9]{6})\.json$/);
  return m ? (m[1] as string) : null;
}
