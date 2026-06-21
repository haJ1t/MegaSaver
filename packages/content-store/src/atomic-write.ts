import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ContentStoreError } from "./errors.js";

// Captured at module load: process.platform is immutable for the
// life of a process, so we read it once instead of per-write.
const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  let renamed = false;
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new ContentStoreError("write_failed", "Store write failed.");
    }

    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    // Durability: fsync the temp file before rename so its bytes are on disk,
    // then fsync the parent dir after rename so the link is durable. POSIX
    // best-practice for atomic-update semantics.
    // Open read-WRITE for the fsync: on Windows FlushFileBuffers requires a
    // write-capable handle (a read-only handle fails with EPERM/ACCESS_DENIED);
    // "r+" works on POSIX too. The temp file already exists (just written).
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    renamed = true;
    // POSIX directory fsync: required on ext4/xfs/APFS so the rename
    // metadata is durable against kernel-panic / power-loss. On Windows
    // (NTFS) the rename's metadata is journaled and durable without a
    // caller-side flush; FlushFileBuffers on a directory handle is a
    // documented no-op, and openSync(dir, "r") itself fails with EISDIR.
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    // After a successful rename the file is committed; the parent-dir fsync is
    // a durability hint, not a correctness gate. Don't fail (or clean up) a
    // write that already landed.
    if (renamed) return;

    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; callers need the original write failure.
    }

    if (error instanceof ContentStoreError) throw error;
    throw new ContentStoreError("write_failed", "Store write failed.", { cause: error });
  }
}
