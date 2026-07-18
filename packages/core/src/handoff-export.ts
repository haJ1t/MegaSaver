export interface HandoffDirtyState {
  headSha: string | null;
  dirty: boolean;
  statusPaths: { path: string; status: string }[];
  diffText: string | null;
}
