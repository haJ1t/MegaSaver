import type { Lm1Kind, Lm1Record, Lm1Snapshot } from "./lm1-model.js";

export type PublishedLm1Record = { inserted: boolean; record: Lm1Record };

export type StateSnapshotLookup = {
  snapshotsByStateKey: ReadonlyMap<string, readonly Lm1Snapshot[]>;
  indexedStateKeys: ReadonlySet<string>;
  incompleteStateKeys: ReadonlySet<string>;
};

export type ClosureSuccessorLookup = {
  successorIdsBySnapshotId: ReadonlyMap<string, readonly string[]>;
  incompletePredecessorSnapshotIds: ReadonlySet<string>;
};

export type FileLm1Store = {
  publish(record: Lm1Record): PublishedLm1Record;
  getByDigest(workspaceKey: string, kind: Lm1Kind, sourceDigest: string): Lm1Record;
  getById(workspaceKey: string, id: string): Lm1Record;
  getByIds?(
    workspaceKey: string,
    entries: readonly Pick<Lm1Record, "id" | "kind" | "sourceDigest">[],
    limit: number,
  ): readonly Lm1Record[];
  list(workspaceKey: string, limit: number): readonly Lm1Record[];
};

export const MAX_LM1_DIRECT_ID_READS = 10_000;

export type Lm1StateIndexStore = FileLm1Store & {
  closureSuccessorIds(
    workspaceKey: string,
    snapshotIds: readonly string[],
    limit?: number,
  ): ClosureSuccessorLookup;
  stateSnapshotsForStateKeys(
    workspaceKey: string,
    stateKeys: readonly string[],
    limit: number,
  ): StateSnapshotLookup;
};

export function supportsLm1StateIndex(store: FileLm1Store): store is Lm1StateIndexStore {
  const candidate = store as Partial<Lm1StateIndexStore>;
  return (
    typeof candidate.closureSuccessorIds === "function" &&
    typeof candidate.stateSnapshotsForStateKeys === "function"
  );
}
