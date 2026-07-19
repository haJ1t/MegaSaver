import type { Lm1Snapshot } from "./lm1-model.js";

export function selectStructuralSnapshotLeaves(
  snapshots: readonly Lm1Snapshot[],
): readonly Lm1Snapshot[] {
  const superseded = new Set(
    snapshots.flatMap((snapshot) =>
      snapshot.supersedesSnapshotId === null ? [] : [snapshot.supersedesSnapshotId],
    ),
  );
  return snapshots.filter((snapshot) => !superseded.has(snapshot.id));
}

export function compareSnapshotsForCurrent(left: Lm1Snapshot, right: Lm1Snapshot): number {
  if (left.observedAt !== right.observedAt) return right.observedAt.localeCompare(left.observedAt);
  if (left.recordedAt !== right.recordedAt) return right.recordedAt.localeCompare(left.recordedAt);
  return left.id.localeCompare(right.id);
}
