import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveTaskKickoffStoreDependencies } from "./task-kickoff-store-fs.js";

export type PrivateFileIdentity = { dev: number; ino: number };
export type PrivateFileSnapshot = PrivateFileIdentity & { mtimeMs: number };

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

// Spec §2.2: a deletion is durable only once the parent directory entry is
// fsynced. Best-effort: a sync failure never changes the outcome, matching
// the no-throw discipline of every best-effort maintenance path.
async function syncParentDirectory(path: string): Promise<void> {
  try {
    await resolveTaskKickoffStoreDependencies().syncDirectory(dirname(path));
  } catch {
    // Best-effort maintenance never propagates a sync failure.
  }
}

export function effectivePosixUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("cache advice requires a POSIX user id");
  return uid;
}

export function requirePrivateRegularFile(stats: Stats, uid: number): PrivateFileSnapshot {
  if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
    throw new Error("cache advice node is unsafe");
  }
  return { dev: stats.dev, ino: stats.ino, mtimeMs: stats.mtimeMs };
}

export function samePrivateFileIdentity(
  left: PrivateFileIdentity,
  right: PrivateFileIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function privateFileSnapshot(
  path: string,
  uid: number,
): Promise<PrivateFileSnapshot | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const named = requirePrivateRegularFile(await lstat(path), uid);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = requirePrivateRegularFile(await handle.stat(), uid);
    if (!samePrivateFileIdentity(named, opened)) {
      throw new Error("cache advice node changed during open");
    }
    return opened;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch {
      // Best-effort maintenance never propagates a close failure.
    }
  }
}

export async function unlinkOwnedFile(
  path: string,
  expected: PrivateFileIdentity,
  uid: number,
): Promise<boolean> {
  try {
    const current = requirePrivateRegularFile(await lstat(path), uid);
    if (!samePrivateFileIdentity(current, expected)) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function normalizeFutureTimestamp(
  path: string,
  expected: PrivateFileSnapshot,
  at: number,
  uid: number,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const current = requirePrivateRegularFile(await handle.stat(), uid);
    if (!samePrivateFileIdentity(current, expected)) return false;
    if (current.mtimeMs <= at) return true;
    const stamp = new Date(at);
    await handle.utimes(stamp, stamp);
    await handle.sync();
    await syncParentDirectory(path);
    return true;
  } catch {
    return false;
  } finally {
    try {
      await handle?.close();
    } catch {
      // Best-effort maintenance never propagates a close failure.
    }
  }
}

// Mirrors gc.ts pruneExpiredPrivateFile semantics: future timestamps are
// normalized (never deleted); only nodes strictly older than the cutoff are
// unlinked, with an identity recheck before unlink.
export async function pruneExpiredPrivateFile(
  path: string,
  cutoffMs: number,
  at: number,
  uid: number,
): Promise<"removed" | "retained" | "unsafe"> {
  try {
    const snapshot = await privateFileSnapshot(path, uid);
    if (snapshot === undefined) return "retained";
    if (snapshot.mtimeMs > at) {
      return (await normalizeFutureTimestamp(path, snapshot, at, uid)) ? "retained" : "unsafe";
    }
    if (snapshot.mtimeMs >= cutoffMs) return "retained";
    const current = await privateFileSnapshot(path, uid);
    if (current === undefined || !samePrivateFileIdentity(current, snapshot)) return "unsafe";
    await unlink(path);
    await syncParentDirectory(path);
    return "removed";
  } catch {
    return "unsafe";
  }
}

export async function writeHandleComplete(
  handle: Awaited<ReturnType<typeof open>>,
  content: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < content.length) {
    const { bytesWritten } = await handle.write(content, offset, content.length - offset, null);
    if (bytesWritten <= 0) throw new Error("cache advice write made no progress");
    offset += bytesWritten;
  }
}

// Atomic durable write: exclusive temp + fsync + rename + directory fsync,
// with the same private-node discipline as every other v3 node.
export async function replacePrivateFile(
  directory: string,
  path: string,
  content: string,
  uid: number,
): Promise<void> {
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let identity: PrivateFileIdentity | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    await handle.chmod(0o600);
    identity = requirePrivateRegularFile(await handle.stat(), uid);
    await writeHandleComplete(handle, Buffer.from(content, "utf8"));
    await handle.sync();
    await handle.close();
    handle = undefined;
    const named = requirePrivateRegularFile(await lstat(temporaryPath), uid);
    if (!samePrivateFileIdentity(named, identity)) {
      throw new Error("cache advice temporary changed before rename");
    }
    await rename(temporaryPath, path);
    await resolveTaskKickoffStoreDependencies().syncDirectory(directory);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the transaction failure.
    }
    if (identity !== undefined) await unlinkOwnedFile(temporaryPath, identity, uid);
    throw error;
  }
}

export async function readBoundedPrivateFile(
  path: string,
  ceiling: number,
  uid: number,
): Promise<{ raw: string; identity: PrivateFileIdentity } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const named = requirePrivateRegularFile(await lstat(path), uid);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stats = await handle.stat();
    const opened = requirePrivateRegularFile(stats, uid);
    if (!samePrivateFileIdentity(named, opened)) {
      throw new Error("cache advice node changed during open");
    }
    if (stats.size > ceiling) {
      throw new Error("cache advice node exceeds its byte ceiling");
    }
    const buffer = Buffer.alloc(ceiling + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > ceiling) {
      throw new Error("cache advice node exceeds its byte ceiling");
    }
    return { raw: buffer.subarray(0, offset).toString("utf8"), identity: opened };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch {
      // Best-effort maintenance never propagates a close failure.
    }
  }
}
