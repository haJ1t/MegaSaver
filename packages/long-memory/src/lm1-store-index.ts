import { opendirSync } from "node:fs";
import { join } from "node:path";
import { Lm1Error } from "./lm1-errors.js";
import type { Lm1Kind, Lm1Record, Lm1Snapshot } from "./lm1-model.js";
import {
  existingLm1ClosureMarkerDirectory,
  existingLm1StateIndexDirectory,
  existingLm1StateSnapshotCoverageDirectory,
  lm1RecordDirectory,
  lm1RecordPath,
} from "./lm1-paths.js";
import type { ClosureSuccessorLookup, StateSnapshotLookup } from "./lm1-store-contracts.js";
import { parseLm1Record } from "./lm1-store-records.js";
import {
  type StateSnapshotCoverage,
  type StateSnapshotPointer,
  parseClosureMarker,
  parseStateSnapshotCoverage,
  parseStateSnapshotPointer,
  pointerMatchesSnapshot,
  stateKeyDigest,
} from "./lm1-store-state.js";

type BoundedJsonNames = { names: readonly string[]; hasMore: boolean };

function listBoundedJsonNames(directory: string, limit: number, label: string): BoundedJsonNames {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Lm1Error("invalid_input", "Invalid long-memory directory read limit.");
  }
  const names: string[] = [];
  try {
    const handle = opendirSync(directory);
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        if (!entry.name.endsWith(".json")) continue;
        if (names.length === limit) return { names: names.sort(), hasMore: true };
        names.push(entry.name);
      }
    } finally {
      handle.closeSync();
    }
  } catch {
    throw new Lm1Error("store_corrupt", `Long-memory ${label} directory is unreadable.`);
  }
  return { names: names.sort(), hasMore: false };
}

function listKind(
  storeRoot: string,
  workspaceKey: string,
  kind: Lm1Kind,
  limit: number,
): Lm1Record[] {
  let directory: string;
  try {
    directory = lm1RecordDirectory(storeRoot, workspaceKey, kind);
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    throw new Lm1Error("store_corrupt", "Long-memory record directory is unreadable.");
  }
  return listBoundedJsonNames(directory, limit, "record").names.map((name) =>
    parseLm1Record(join(directory, name), {
      workspaceKey,
      kind,
      sourceDigest: name.slice(0, -".json".length),
    }),
  );
}

export function listLm1Records(
  storeRoot: string,
  workspaceKey: string,
  limit: number,
): readonly Lm1Record[] {
  const snapshots = listKind(storeRoot, workspaceKey, "state_snapshot", limit);
  const remaining = limit - snapshots.length;
  if (remaining === 0) return snapshots;
  return [...snapshots, ...listKind(storeRoot, workspaceKey, "state_transition", remaining)];
}

export function snapshotsForStateKeys(
  storeRoot: string,
  workspaceKey: string,
  stateKeys: readonly string[],
  limit: number,
): StateSnapshotLookup {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Lm1Error("invalid_input", "Invalid LM1 state index limit.");
  }
  const snapshotsByStateKey = new Map<string, readonly Lm1Snapshot[]>();
  const indexedStateKeys = new Set<string>();
  const incompleteStateKeys = new Set<string>();
  let remaining = limit;
  for (const stateKey of [...new Set(stateKeys)]) {
    const directory = existingLm1StateIndexDirectory(
      storeRoot,
      workspaceKey,
      stateKeyDigest(stateKey),
    );
    if (directory === null) continue;
    indexedStateKeys.add(stateKey);
    if (remaining === 0) {
      incompleteStateKeys.add(stateKey);
      snapshotsByStateKey.set(stateKey, []);
      continue;
    }
    const pointerNames = listBoundedJsonNames(directory, remaining, "state index");
    const coverageDirectory = existingLm1StateSnapshotCoverageDirectory(
      storeRoot,
      workspaceKey,
      stateKeyDigest(stateKey),
    );
    let coverageNames: BoundedJsonNames | undefined;
    if (coverageDirectory === null) {
      incompleteStateKeys.add(stateKey);
    } else {
      coverageNames = listBoundedJsonNames(coverageDirectory, remaining, "state coverage");
    }
    if (pointerNames.hasMore || coverageNames?.hasMore) {
      incompleteStateKeys.add(stateKey);
      snapshotsByStateKey.set(stateKey, []);
      continue;
    }
    const coverageBySourceDigest = new Map<string, StateSnapshotCoverage>();
    for (const name of coverageNames?.names ?? []) {
      const coverage = parseStateSnapshotCoverage(
        join(coverageDirectory as string, name),
        name,
        workspaceKey,
        stateKey,
      );
      coverageBySourceDigest.set(coverage.sourceDigest, coverage);
    }
    const pointers: StateSnapshotPointer[] = [];
    for (const name of pointerNames.names) {
      pointers.push(parseStateSnapshotPointer(join(directory, name), name, workspaceKey, stateKey));
    }
    const pointerSourceDigests = new Set(pointers.map((pointer) => pointer.sourceDigest));
    if (
      pointerSourceDigests.size !== pointerNames.names.length ||
      coverageBySourceDigest.size !== (coverageNames?.names.length ?? 0) ||
      pointerSourceDigests.size !== coverageBySourceDigest.size ||
      pointers.some((pointer) => {
        const coverage = coverageBySourceDigest.get(pointer.sourceDigest);
        return coverage === undefined || coverage.snapshotId !== pointer.snapshotId;
      })
    ) {
      incompleteStateKeys.add(stateKey);
    }
    const snapshots: Lm1Snapshot[] = [];
    for (const pointer of pointers) {
      try {
        const snapshot = parseLm1Record(
          lm1RecordPath(storeRoot, workspaceKey, "state_snapshot", pointer.sourceDigest),
          { workspaceKey, kind: "state_snapshot", sourceDigest: pointer.sourceDigest },
        );
        if (snapshot.kind !== "state_snapshot" || !pointerMatchesSnapshot(pointer, snapshot)) {
          throw new Lm1Error(
            "store_corrupt",
            "Long-memory state pointer does not match its snapshot.",
          );
        }
        snapshots.push(snapshot);
      } catch (error) {
        if (error instanceof Lm1Error && error.code === "not_found") {
          incompleteStateKeys.add(stateKey);
          continue;
        }
        throw error;
      }
    }
    remaining -= pointerNames.names.length;
    snapshotsByStateKey.set(stateKey, snapshots);
  }
  return { snapshotsByStateKey, indexedStateKeys, incompleteStateKeys };
}

export function closureSuccessorIds(
  storeRoot: string,
  workspaceKey: string,
  snapshotIds: readonly string[],
  limit = 10_000,
): ClosureSuccessorLookup {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Lm1Error("invalid_input", "Invalid LM1 closure read limit.");
  }
  const successorsBySnapshotId = new Map<string, readonly string[]>();
  const incompletePredecessorSnapshotIds = new Set<string>();
  let remaining = limit;
  for (const predecessorSnapshotId of [...new Set(snapshotIds)]) {
    const directory = existingLm1ClosureMarkerDirectory(
      storeRoot,
      workspaceKey,
      predecessorSnapshotId,
    );
    if (directory === null) continue;
    if (remaining === 0) {
      incompletePredecessorSnapshotIds.add(predecessorSnapshotId);
      continue;
    }
    const names = listBoundedJsonNames(directory, remaining, "closure");
    if (names.hasMore) {
      incompletePredecessorSnapshotIds.add(predecessorSnapshotId);
      continue;
    }
    const successorSnapshotIds = names.names.map((name) => {
      const successorSnapshotId = name.slice(0, -".json".length);
      parseClosureMarker(join(directory, name), {
        workspaceKey,
        predecessorSnapshotId,
        successorSnapshotId,
      });
      return successorSnapshotId;
    });
    if (successorSnapshotIds.length > 0) {
      successorsBySnapshotId.set(predecessorSnapshotId, successorSnapshotIds);
    }
    remaining -= successorSnapshotIds.length;
  }
  return { successorIdsBySnapshotId: successorsBySnapshotId, incompletePredecessorSnapshotIds };
}
