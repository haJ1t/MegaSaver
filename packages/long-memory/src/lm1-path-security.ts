import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";
import { Lm1Error } from "./lm1-errors.js";

export function assertLm1PathIsNotSymlink(path: string): void {
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
    if (parent === undefined || parent.uid !== 0 || (parent.mode & 0o022) !== 0) return false;
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

export function ensureLm1Directory(path: string): void {
  assertExistingAncestorsAreNotSymlinks(path);
  assertLm1PathIsNotSymlink(path);
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
  assertLm1PathIsNotSymlink(path);
  syncDirectoryChain(path);
}

export function existingLm1Directory(path: string): boolean {
  return existingDirectory(path);
}
