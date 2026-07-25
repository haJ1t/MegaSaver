import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { Lm1Error } from "./lm1-errors.js";
import { type Lm1Kind, lm1KindSchema } from "./lm1-model.js";
import {
  assertLm1PathIsNotSymlink,
  ensureLm1Directory,
  existingLm1Directory,
} from "./lm1-path-security.js";

export { assertLm1PathIsNotSymlink, isKnownDarwinSystemAlias } from "./lm1-path-security.js";

const sourceDigestPattern = /^[0-9a-f]{64}$/;
const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stateIndexPointerPattern = /^[0-9]{17}-[0-9]{17}-[0-9a-f-]{36}-[0-9a-f]{64}\.json$/;

function parseWorkspaceKey(workspaceKey: string): string {
  const parsedWorkspaceKey = workspaceKeySchema.safeParse(workspaceKey);
  if (!parsedWorkspaceKey.success) throw new Lm1Error("invalid_input", "Invalid workspace key.");
  return parsedWorkspaceKey.data;
}

function assertSnapshotId(snapshotId: string): void {
  if (!lowercaseUuidPattern.test(snapshotId)) {
    throw new Lm1Error("invalid_input", "Invalid long-memory snapshot id.");
  }
}

function workspaceDirectory(storeRoot: string, workspaceKey: string): string {
  const root = join(storeRoot, "long-memory");
  const version = join(root, "v1");
  const workspace = join(version, workspaceKey);
  ensureLm1Directory(storeRoot);
  ensureLm1Directory(root);
  ensureLm1Directory(version);
  ensureLm1Directory(workspace);
  return workspace;
}

export function lm1WorkspaceDirectory(storeRoot: string, workspaceKey: string): string {
  return workspaceDirectory(storeRoot, parseWorkspaceKey(workspaceKey));
}

export function lm1RecordDirectory(storeRoot: string, workspaceKey: string, kind: Lm1Kind): string {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  const parsedKind = lm1KindSchema.safeParse(kind);
  if (!parsedKind.success) {
    throw new Lm1Error("invalid_input", "Invalid long-memory record kind.");
  }
  const records = join(
    workspaceDirectory(storeRoot, parsedWorkspaceKey),
    parsedKind.data === "state_snapshot" ? "snapshots" : "transitions",
  );
  ensureLm1Directory(records);
  return records;
}

export function lm1RecordPath(
  storeRoot: string,
  workspaceKey: string,
  kind: Lm1Kind,
  sourceDigest: string,
): string {
  if (!sourceDigestPattern.test(sourceDigest)) {
    throw new Lm1Error("invalid_input", "Invalid long-memory source digest.");
  }
  const directory = lm1RecordDirectory(storeRoot, workspaceKey, kind);
  const path = join(directory, `${sourceDigest}.json`);
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function lm1RecordIdLocatorPath(
  storeRoot: string,
  workspaceKey: string,
  id: string,
): string {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  assertSnapshotId(id);
  const locators = join(workspaceDirectory(storeRoot, parsedWorkspaceKey), "record-ids");
  ensureLm1Directory(locators);
  const path = join(locators, `${id}.json`);
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function lm1ClosureMarkerPath(
  storeRoot: string,
  workspaceKey: string,
  predecessorSnapshotId: string,
  successorSnapshotId: string,
): string {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  assertSnapshotId(predecessorSnapshotId);
  assertSnapshotId(successorSnapshotId);
  const closures = join(workspaceDirectory(storeRoot, parsedWorkspaceKey), "closures");
  const predecessor = join(closures, predecessorSnapshotId);
  ensureLm1Directory(closures);
  ensureLm1Directory(predecessor);
  const path = join(predecessor, `${successorSnapshotId}.json`);
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function existingLm1ClosureMarkerDirectory(
  storeRoot: string,
  workspaceKey: string,
  predecessorSnapshotId: string,
): string | null {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  assertSnapshotId(predecessorSnapshotId);
  const root = join(storeRoot, "long-memory");
  const version = join(root, "v1");
  const workspace = join(version, parsedWorkspaceKey);
  const closures = join(workspace, "closures");
  const predecessor = join(closures, predecessorSnapshotId);
  for (const path of [storeRoot, root, version, workspace, closures, predecessor]) {
    if (!existingLm1Directory(path)) return null;
  }
  return predecessor;
}

export function lm1StateIndexPointerPath(
  storeRoot: string,
  workspaceKey: string,
  stateKeyDigest: string,
  pointerName: string,
): string {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  if (!sourceDigestPattern.test(stateKeyDigest) || !stateIndexPointerPattern.test(pointerName)) {
    throw new Lm1Error("invalid_input", "Invalid long-memory state index pointer.");
  }
  const index = join(workspaceDirectory(storeRoot, parsedWorkspaceKey), "state-index");
  const stateKey = join(index, stateKeyDigest);
  ensureLm1Directory(index);
  ensureLm1Directory(stateKey);
  const path = join(stateKey, pointerName);
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function lm1StateSnapshotReservationPath(
  storeRoot: string,
  workspaceKey: string,
  sourceDigest: string,
): string {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  if (!sourceDigestPattern.test(sourceDigest)) {
    throw new Lm1Error("invalid_input", "Invalid long-memory source digest.");
  }
  const reservations = join(workspaceDirectory(storeRoot, parsedWorkspaceKey), "reservations");
  const snapshots = join(reservations, "snapshots");
  ensureLm1Directory(reservations);
  ensureLm1Directory(snapshots);
  const path = join(snapshots, `${sourceDigest}.json`);
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function lm1StateSnapshotCoveragePath(
  storeRoot: string,
  workspaceKey: string,
  stateKeyDigest: string,
  sourceDigest: string,
): string {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  if (!sourceDigestPattern.test(stateKeyDigest) || !sourceDigestPattern.test(sourceDigest)) {
    throw new Lm1Error("invalid_input", "Invalid long-memory state snapshot coverage.");
  }
  const index = join(workspaceDirectory(storeRoot, parsedWorkspaceKey), "state-index");
  const stateKey = join(index, stateKeyDigest);
  const coverage = join(stateKey, "coverage");
  ensureLm1Directory(index);
  ensureLm1Directory(stateKey);
  ensureLm1Directory(coverage);
  const path = join(coverage, `${sourceDigest}.json`);
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function existingLm1StateIndexDirectory(
  storeRoot: string,
  workspaceKey: string,
  stateKeyDigest: string,
): string | null {
  const parsedWorkspaceKey = parseWorkspaceKey(workspaceKey);
  if (!sourceDigestPattern.test(stateKeyDigest)) {
    throw new Lm1Error("invalid_input", "Invalid long-memory state key digest.");
  }
  const root = join(storeRoot, "long-memory");
  const version = join(root, "v1");
  const workspace = join(version, parsedWorkspaceKey);
  const index = join(workspace, "state-index");
  const stateKey = join(index, stateKeyDigest);
  for (const path of [storeRoot, root, version, workspace, index, stateKey]) {
    if (!existingLm1Directory(path)) return null;
  }
  return stateKey;
}

export function existingLm1StateSnapshotCoverageDirectory(
  storeRoot: string,
  workspaceKey: string,
  stateKeyDigest: string,
): string | null {
  const stateKey = existingLm1StateIndexDirectory(storeRoot, workspaceKey, stateKeyDigest);
  if (stateKey === null) return null;
  const coverage = join(stateKey, "coverage");
  return existingLm1Directory(coverage) ? coverage : null;
}
