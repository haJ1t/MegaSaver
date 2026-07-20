import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { Lm1Error } from "./lm1-errors.js";
import { type Lm1Kind, lm1KindSchema } from "./lm1-model.js";

const sourceDigestPattern = /^[0-9a-f]{64}$/;
const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stateIndexPointerPattern = /^[0-9]{17}-[0-9]{17}-[0-9a-f-]{36}-[0-9a-f]{64}\.json$/;

function assertNotSymlink(path: string): void {
  try {
    if (!lstatSync(path).isSymbolicLink()) return;
    throw new Lm1Error("store_corrupt", "Long-memory path is a symbolic link.");
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new Lm1Error("store_corrupt", "Long-memory path is unreadable.");
  }
}

export function isKnownDarwinSystemAlias(
  path: string,
  target: string,
  platform: NodeJS.Platform,
): boolean {
  return (
    platform === "darwin" &&
    ((path === "/var" && target === "/private/var") ||
      (path === "/tmp" && target === "/private/tmp"))
  );
}

function isProtectedPlatformAlias(
  path: string,
  symlink: NonNullable<ReturnType<typeof lstatSync>>,
): boolean {
  if (symlink.uid !== 0) return false;
  try {
    const parent = lstatSync(dirname(path));
    if (parent === undefined) return false;
    if (parent.uid !== 0 || (parent.mode & 0o022) !== 0) return false;
    return isKnownDarwinSystemAlias(path, realpathSync(path), process.platform);
  } catch {
    return false;
  }
}

function assertExistingAncestorsAreNotSymlinks(path: string): void {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  let current = root;
  for (const segment of relative(root, absolutePath).split(sep).filter(Boolean)) {
    current = join(current, segment);
    let stat: NonNullable<ReturnType<typeof lstatSync>>;
    try {
      const resolvedStat = lstatSync(current);
      if (resolvedStat === undefined) {
        throw new Lm1Error("store_corrupt", "Long-memory path is unreadable.");
      }
      stat = resolvedStat;
    } catch (error) {
      if (error instanceof Lm1Error) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new Lm1Error("store_corrupt", "Long-memory path is unreadable.");
    }
    if (stat.isSymbolicLink() && !isProtectedPlatformAlias(current, stat)) {
      throw new Lm1Error("store_corrupt", "Long-memory path is a symbolic link.");
    }
  }
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  let descriptor: number | undefined;
  let failure: Lm1Error | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    failure = new Lm1Error("write_failed", "Long-memory directory sync failed.");
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch {
      failure = new Lm1Error("write_failed", "Long-memory directory sync failed.");
    }
  }
  if (failure !== undefined) throw failure;
}

function syncDirectoryChain(finalDirectory: string): void {
  const absolutePath = resolve(finalDirectory);
  const root = parse(absolutePath).root;
  fsyncDirectory(root);
  let current = root;
  for (const segment of relative(root, absolutePath).split(sep).filter(Boolean)) {
    current = join(current, segment);
    fsyncDirectory(current);
  }
}

function ensureDirectory(path: string): void {
  assertExistingAncestorsAreNotSymlinks(path);
  assertNotSymlink(path);
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    if (!existingDirectory(path)) {
      throw new Lm1Error("write_failed", "Long-memory directory creation failed.");
    }
  }
  if (!existingDirectory(path)) {
    throw new Lm1Error("write_failed", "Long-memory directory creation failed.");
  }
  assertNotSymlink(path);
  syncDirectoryChain(path);
}

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
  ensureDirectory(storeRoot);
  ensureDirectory(root);
  ensureDirectory(version);
  ensureDirectory(workspace);
  return workspace;
}

function existingDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Lm1Error("store_corrupt", "Long-memory path is a symbolic link.");
    }
    if (!stat.isDirectory()) {
      throw new Lm1Error("store_corrupt", "Long-memory path is not a directory.");
    }
    return true;
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new Lm1Error("store_corrupt", "Long-memory path is unreadable.");
  }
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
  ensureDirectory(records);
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
  assertNotSymlink(path);
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
  ensureDirectory(locators);
  const path = join(locators, `${id}.json`);
  assertNotSymlink(path);
  return path;
}

export function assertLm1PathIsNotSymlink(path: string): void {
  assertNotSymlink(path);
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
  ensureDirectory(closures);
  ensureDirectory(predecessor);
  const path = join(predecessor, `${successorSnapshotId}.json`);
  assertNotSymlink(path);
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
    if (!existingDirectory(path)) return null;
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
  ensureDirectory(index);
  ensureDirectory(stateKey);
  const path = join(stateKey, pointerName);
  assertNotSymlink(path);
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
  ensureDirectory(reservations);
  ensureDirectory(snapshots);
  const path = join(snapshots, `${sourceDigest}.json`);
  assertNotSymlink(path);
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
  ensureDirectory(index);
  ensureDirectory(stateKey);
  ensureDirectory(coverage);
  const path = join(coverage, `${sourceDigest}.json`);
  assertNotSymlink(path);
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
    if (!existingDirectory(path)) return null;
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
  return existingDirectory(coverage) ? coverage : null;
}
