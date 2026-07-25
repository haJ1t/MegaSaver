import type { Lm1Record, Lm1Snapshot } from "./lm1-model.js";
import { compareSnapshotsForCurrent, selectStructuralSnapshotLeaves } from "./lm1-state.js";
import type { ClosureSuccessorLookup, StateSnapshotLookup } from "./lm1-store.js";

export type Lm1RankedRecord = { score: number; record: Lm1Record };
export type Lm1StateGroup = { leaves: readonly Lm1Snapshot[]; incomplete: boolean };
export type Lm1SelectionCandidate =
  | { type: "state"; anchor: { score: number; record: Lm1Snapshot }; group: Lm1StateGroup }
  | { type: "transition"; anchor: Lm1RankedRecord };

export function compareLm1RankedRecords(left: Lm1RankedRecord, right: Lm1RankedRecord): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.record.observedAt !== right.record.observedAt) {
    return right.record.observedAt.localeCompare(left.record.observedAt);
  }
  return left.record.id.localeCompare(right.record.id);
}

export function lm1StateGroups(
  snapshots: readonly Lm1Snapshot[],
  lookup: StateSnapshotLookup,
  closureLookup: ClosureSuccessorLookup,
): ReadonlyMap<string, Lm1StateGroup> {
  const rawByStateKey = new Map<string, Lm1Snapshot[]>();
  for (const snapshot of snapshots) {
    const stateSnapshots = rawByStateKey.get(snapshot.stateKey) ?? [];
    stateSnapshots.push(snapshot);
    rawByStateKey.set(snapshot.stateKey, stateSnapshots);
  }
  const groups = new Map<string, Lm1StateGroup>();
  for (const stateKey of rawByStateKey.keys()) {
    if (!lookup.indexedStateKeys.has(stateKey)) {
      groups.set(stateKey, { leaves: [], incomplete: true });
      continue;
    }
    const indexedSnapshots = lookup.snapshotsByStateKey.get(stateKey) ?? [];
    const indexedIds = new Set(indexedSnapshots.map(({ id }) => id));
    const requiredSuccessors = new Set(
      indexedSnapshots.flatMap(({ id }) => closureLookup.successorIdsBySnapshotId.get(id) ?? []),
    );
    groups.set(stateKey, {
      leaves: [...selectStructuralSnapshotLeaves(indexedSnapshots)].sort(
        compareSnapshotsForCurrent,
      ),
      incomplete:
        lookup.incompleteStateKeys.has(stateKey) ||
        indexedSnapshots.some(({ id }) => closureLookup.incompletePredecessorSnapshotIds.has(id)) ||
        (rawByStateKey.get(stateKey) ?? []).some(({ id }) => !indexedIds.has(id)) ||
        [...requiredSuccessors].some((id) => !indexedIds.has(id)),
    });
  }
  return groups;
}

export function lm1SelectionCandidates(
  ranked: readonly Lm1RankedRecord[],
  groups: ReadonlyMap<string, Lm1StateGroup>,
): readonly Lm1SelectionCandidate[] {
  const candidates: Lm1SelectionCandidate[] = [];
  const admittedStateKeys = new Set<string>();
  for (const anchor of ranked) {
    if (anchor.record.kind === "state_transition") {
      candidates.push({ type: "transition", anchor });
      continue;
    }
    if (admittedStateKeys.has(anchor.record.stateKey)) continue;
    const group = groups.get(anchor.record.stateKey);
    if (group === undefined) continue;
    admittedStateKeys.add(anchor.record.stateKey);
    candidates.push({
      type: "state",
      anchor: { score: anchor.score, record: anchor.record },
      group,
    });
  }
  return candidates;
}

export function requiredLm1EvidenceIds(
  record: Lm1Record,
  recordsById: ReadonlyMap<string, Lm1Record>,
): readonly string[] {
  if (record.kind !== "state_transition") return record.evidenceIds;
  const pre = recordsById.get(record.preSnapshotId);
  const post = recordsById.get(record.postSnapshotId);
  if (pre === undefined || post === undefined) return [];
  return [...new Set([...record.evidenceIds, ...pre.evidenceIds, ...post.evidenceIds])].sort();
}
