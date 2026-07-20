import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Lm1Error } from "./lm1-errors.js";
import type { Lm1Record, Lm1Snapshot } from "./lm1-model.js";
import {
  assertLm1PathIsNotSymlink,
  lm1ClosureMarkerPath,
  lm1RecordIdLocatorPath,
  lm1StateIndexPointerPath,
  lm1StateSnapshotCoveragePath,
  lm1StateSnapshotReservationPath,
} from "./lm1-paths.js";
import { type RecordIdLocator, parseRecordIdLocator } from "./lm1-store-records.js";
import {
  type ClosureMarker,
  type StateSnapshotCoverage,
  type StateSnapshotPointer,
  type StateSnapshotReservation,
  parseClosureMarker,
  parseStateSnapshotCoverage,
  parseStateSnapshotPointer,
  parseStateSnapshotReservation,
  stateKeyDigest,
  stateSnapshotPointerName,
} from "./lm1-store-state.js";

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

export function publishNoClobber(path: string, serialized: string): "created" | "exists" {
  const directory = dirname(path);
  const tempPath = join(directory, `.${randomUUID()}.tmp`);
  assertLm1PathIsNotSymlink(tempPath);
  try {
    writeFileSync(tempPath, serialized, { flag: "wx" });
    fsyncFile(tempPath);
    try {
      linkSync(tempPath, path);
      fsyncDirectory(directory);
      return "created";
    } catch (error) {
      if (isAlreadyExists(error)) return "exists";
      throw error;
    }
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    throw new Lm1Error("write_failed", "Long-memory record write failed.");
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function publishClosureMarker(storeRoot: string, record: Lm1Record): void {
  if (record.kind !== "state_snapshot" || record.supersedesSnapshotId === null) return;
  const marker: ClosureMarker = {
    workspaceKey: record.workspaceKey,
    predecessorSnapshotId: record.supersedesSnapshotId,
    successorSnapshotId: record.id,
  };
  const path = lm1ClosureMarkerPath(
    storeRoot,
    marker.workspaceKey,
    marker.predecessorSnapshotId,
    marker.successorSnapshotId,
  );
  if (publishNoClobber(path, `${JSON.stringify(marker)}\n`) === "exists") {
    parseClosureMarker(path, marker);
  }
}

export function publishRecordIdLocator(storeRoot: string, record: Lm1Record): void {
  const locator: RecordIdLocator = {
    workspaceKey: record.workspaceKey,
    id: record.id,
    kind: record.kind,
    sourceDigest: record.sourceDigest,
  };
  const path = lm1RecordIdLocatorPath(storeRoot, locator.workspaceKey, locator.id);
  if (publishNoClobber(path, `${JSON.stringify(locator)}\n`) === "exists") {
    const existing = parseRecordIdLocator(path, locator);
    if (existing.kind !== locator.kind || existing.sourceDigest !== locator.sourceDigest) {
      throw new Lm1Error("store_corrupt", "Long-memory record locator conflicts with its record.");
    }
  }
}

function stateSnapshotPointer(record: Lm1Snapshot): StateSnapshotPointer {
  return {
    workspaceKey: record.workspaceKey,
    stateKey: record.stateKey,
    snapshotId: record.id,
    sourceDigest: record.sourceDigest,
    observedAt: record.observedAt,
    recordedAt: record.recordedAt,
    supersedesSnapshotId: record.supersedesSnapshotId,
  };
}

export function publishStateSnapshotPointer(storeRoot: string, record: Lm1Record): void {
  if (record.kind !== "state_snapshot") return;
  const pointer = stateSnapshotPointer(record);
  const name = stateSnapshotPointerName(pointer);
  const path = lm1StateIndexPointerPath(
    storeRoot,
    pointer.workspaceKey,
    stateKeyDigest(pointer.stateKey),
    name,
  );
  if (publishNoClobber(path, `${JSON.stringify(pointer)}\n`) === "exists") {
    parseStateSnapshotPointer(path, name, pointer.workspaceKey, pointer.stateKey);
  }
}

function stateSnapshotCoverage(record: Lm1Snapshot): StateSnapshotCoverage {
  return {
    workspaceKey: record.workspaceKey,
    stateKey: record.stateKey,
    snapshotId: record.id,
    sourceDigest: record.sourceDigest,
  };
}

export function publishStateSnapshotCoverage(storeRoot: string, record: Lm1Record): void {
  if (record.kind !== "state_snapshot") return;
  const coverage = stateSnapshotCoverage(record);
  const path = lm1StateSnapshotCoveragePath(
    storeRoot,
    coverage.workspaceKey,
    stateKeyDigest(coverage.stateKey),
    coverage.sourceDigest,
  );
  if (publishNoClobber(path, `${JSON.stringify(coverage)}\n`) === "exists") {
    const existing = parseStateSnapshotCoverage(
      path,
      `${coverage.sourceDigest}.json`,
      coverage.workspaceKey,
      coverage.stateKey,
    );
    if (existing.snapshotId !== coverage.snapshotId) {
      throw new Lm1Error(
        "store_corrupt",
        "Long-memory state coverage conflicts with its snapshot.",
      );
    }
  }
}

export function reserveStateSnapshotRecordedAt(
  storeRoot: string,
  record: Lm1Snapshot,
): Lm1Snapshot {
  const reservation: StateSnapshotReservation = {
    workspaceKey: record.workspaceKey,
    sourceDigest: record.sourceDigest,
    recordedAt: record.recordedAt,
  };
  const path = lm1StateSnapshotReservationPath(
    storeRoot,
    reservation.workspaceKey,
    reservation.sourceDigest,
  );
  if (publishNoClobber(path, `${JSON.stringify(reservation)}\n`) === "created") return record;
  const durableReservation = parseStateSnapshotReservation(path, reservation);
  return { ...record, recordedAt: durableReservation.recordedAt };
}
