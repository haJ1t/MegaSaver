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

const IS_WIN32 = process.platform === "win32";

export class AtomicWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtomicWriteError";
  }
}

export function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
  opts?: { mode?: number },
): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);
  let renamed = false;

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new AtomicWriteError(`refusing to write through symlinked directory ${parentDir}`);
    }

    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content, { mode: opts?.mode ?? 0o666 });
    // Durability: fsync the temp file (write-capable "r+" handle — Windows
    // FlushFileBuffers needs write access) before rename, then fsync the parent
    // dir after rename so the link is durable.
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    renamed = true;
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    if (!renamed) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // Ignore cleanup failures; the original error is what matters.
      }
      if (error instanceof AtomicWriteError) throw error;
      throw new AtomicWriteError(
        `atomic write failed for ${filePath}: ${(error as Error).message}`,
      );
    }
    // Rename already succeeded: the write IS committed. A dir-fsync failure here
    // must not report failure for durable data.
  }
}
