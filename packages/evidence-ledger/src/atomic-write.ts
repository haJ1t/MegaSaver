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
import { EvidenceLedgerError } from "./errors.js";

const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new EvidenceLedgerError("write_failed", "Ledger write failed.");
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
      // Ignore cleanup failure; surface the original write error.
    }
    if (error instanceof EvidenceLedgerError) throw error;
    throw new EvidenceLedgerError("write_failed", "Ledger write failed.", { cause: error });
  }
}
