import { type ExecGit, gatherCommittedPaths, gatherDirtyState } from "../../../git-delta.js";

export type ObservedDelta = { paths: string[]; dirtyCount: number; committedCount: number };

export function observeTreeDelta(input: {
  cwd: string;
  startedAt: string;
  endedAt: string | null;
  execGit?: ExecGit;
}): ObservedDelta | null {
  const dirty =
    input.execGit === undefined
      ? gatherDirtyState(input.cwd)
      : gatherDirtyState(input.cwd, input.execGit);
  if (dirty === null) return null;
  const committed =
    (input.execGit === undefined
      ? gatherCommittedPaths(input.cwd, input.startedAt, input.endedAt)
      : gatherCommittedPaths(input.cwd, input.startedAt, input.endedAt, input.execGit)) ?? [];
  const dirtyPaths = dirty.statusPaths.map((entry) => entry.path);
  return {
    paths: [...new Set([...dirtyPaths, ...committed])],
    dirtyCount: dirtyPaths.length,
    committedCount: committed.length,
  };
}
