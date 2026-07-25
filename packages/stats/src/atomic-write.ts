import { randomUUID } from "node:crypto";
import {
  chmodSync,
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
import { StatsError } from "./errors.js";

const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new StatsError("write_failed");
    }

    // Owner-only: the store holds captured prompts and tool output. The chmod
    // is the backstop — mkdir's mode is a no-op on an existing dir.
    mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    chmodSync(parentDir, 0o700);
    writeFileSync(tempPath, content, { mode: 0o600 });
    // Durability: fsync the temp file before rename so its bytes are on disk,
    // then fsync the parent dir after rename so the link is durable.
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
    // POSIX directory fsync makes the rename metadata durable on APFS/ext4/xfs.
    // Windows journals rename metadata and openSync(dir, "r") fails with EISDIR,
    // so we branch on platform rather than swallow a real EPERM.
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; the original write error is what matters.
    }

    if (error instanceof StatsError) {
      throw error;
    }
    throw new StatsError("write_failed");
  }
}
