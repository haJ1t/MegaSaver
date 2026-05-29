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
import { StatsError } from "./errors.js";

const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new StatsError("write_failed");
    }

    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    // Durability: fsync the temp file before rename so its bytes are on disk,
    // then fsync the parent dir after rename so the link is durable.
    const tempFd = openSync(tempPath, "r");
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
