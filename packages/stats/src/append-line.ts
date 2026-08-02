import {
  constants,
  chmodSync,
  closeSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const IS_WIN32 = process.platform === "win32";
const APPEND_LOCK_DEADLINE_MS = 500;
const APPEND_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));
const TAIL_SCAN_BYTES = 8192;
const require = createRequire(import.meta.url);

type FlockSync = (descriptor: number, operation: "exnb" | "un") => void;

function flock(descriptor: number, operation: "exnb" | "un"): void {
  const { flockSync } = require("fs-ext") as { flockSync: FlockSync };
  flockSync(descriptor, operation);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isLockUnavailable(error: unknown): boolean {
  return hasErrorCode(error, "EAGAIN") || hasErrorCode(error, "EWOULDBLOCK");
}

function acquireAppendLock(descriptor: number): boolean {
  const deadline = Date.now() + APPEND_LOCK_DEADLINE_MS;
  for (;;) {
    try {
      flock(descriptor, "exnb");
      return true;
    } catch (error) {
      if (!isLockUnavailable(error)) throw error;
      if (Date.now() >= deadline) return false;
      Atomics.wait(APPEND_LOCK_WAIT, 0, 0, 10);
    }
  }
}

function repairPartialTail(descriptor: number, size: number): void {
  if (size === 0) return;
  const buffer = Buffer.alloc(Math.min(TAIL_SCAN_BYTES, size));
  let end = size;
  while (end > 0) {
    const length = Math.min(buffer.byteLength, end);
    const start = end - length;
    const bytesRead = readSync(descriptor, buffer, 0, length, start);
    for (let index = bytesRead - 1; index >= 0; index -= 1) {
      if (buffer[index] === 0x0a) {
        const repairedSize = start + index + 1;
        if (repairedSize < size) ftruncateSync(descriptor, repairedSize);
        return;
      }
    }
    end = start;
  }
  ftruncateSync(descriptor, 0);
}

// Every JSONL under the store is owner-only: the event stream reveals what the
// agent read and ran, and it sits beside the captured prompt. The chmods are
// backstops for existing paths; POSIX binds the file mode and write to the same
// no-follow, non-blocking descriptor so a stable final symlink cannot escape
// the private store and a FIFO cannot stall before its type is rejected.
// Windows retains the existing path chmod because fchmod is unavailable.
export function appendPrivateLine(path: string, line: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const flags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT;
  const descriptor = openSync(
    path,
    IS_WIN32 ? flags : flags | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  );
  let locked = false;
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("private append target is not a regular file");
    if (IS_WIN32) chmodSync(path, 0o600);
    else fchmodSync(descriptor, 0o600);
    locked = acquireAppendLock(descriptor);
    if (!locked) throw new Error("private append target is busy");
    const lockedStats = fstatSync(descriptor);
    if (!lockedStats.isFile()) throw new Error("private append target is not a regular file");
    repairPartialTail(descriptor, lockedStats.size);
    const rollbackSize = fstatSync(descriptor).size;
    const bytes = Buffer.from(line);
    let offset = 0;
    try {
      while (offset < bytes.byteLength) {
        const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
        if (written <= 0) throw new Error("private append made no write progress");
        offset += written;
      }
    } catch (error) {
      ftruncateSync(descriptor, rollbackSize);
      throw error;
    }
  } finally {
    if (locked) {
      try {
        flock(descriptor, "un");
      } catch {
        // Closing the descriptor releases the advisory lock.
      }
    }
    closeSync(descriptor);
  }
}
