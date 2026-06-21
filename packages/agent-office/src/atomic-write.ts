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
import { AgentOfficeError } from "./errors.js";

const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  let renamed = false;
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new AgentOfficeError("write_failed", "Store write failed.");
    }

    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    renamed = true;
    // Windows does not support fsync on directory handles; the rename is durable via NTFS journaling.
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
      // Ignore cleanup failures; surface the original write error.
    }
    if (error instanceof AgentOfficeError) throw error;
    throw new AgentOfficeError("write_failed", "Store write failed.", { cause: error });
  }
}
