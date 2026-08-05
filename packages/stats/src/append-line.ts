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
  truncateSync,
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

// Windows opens an O_APPEND descriptor with FILE_APPEND_DATA-only access (no
// FILE_WRITE_DATA), so ftruncateSync on that same descriptor fails EPERM. A
// path-based truncate opens a fresh handle with full access instead. POSIX
// keeps the fd-based truncate: no new open, no extra path resolution.
function truncateOpenFile(descriptor: number, path: string, size: number): void {
  if (IS_WIN32) truncateSync(path, size);
  else ftruncateSync(descriptor, size);
}

function acquireAppendLock(descriptor: number, deadlineAtMs: number): boolean {
  if (Date.now() >= deadlineAtMs) return false;
  for (;;) {
    try {
      flock(descriptor, "exnb");
      return true;
    } catch (error) {
      if (!isLockUnavailable(error)) throw error;
      const remainingMs = deadlineAtMs - Date.now();
      if (remainingMs <= 0) return false;
      Atomics.wait(APPEND_LOCK_WAIT, 0, 0, Math.min(10, remainingMs));
    }
  }
}

function repairPartialTail(descriptor: number, path: string, size: number): void {
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
        if (repairedSize < size) truncateOpenFile(descriptor, path, repairedSize);
        return;
      }
    }
    end = start;
  }
  truncateOpenFile(descriptor, path, 0);
}

function assertBeforeDeadline(deadlineAtMs: number | undefined): void {
  if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
    throw new Error("private append deadline expired");
  }
}

// Every JSONL under the store is owner-only: the event stream reveals what the
// agent read and ran, and it sits beside the captured prompt. The chmods are
// backstops for existing paths; POSIX binds the file mode and write to the same
// no-follow, non-blocking descriptor so a stable final symlink cannot escape
// the private store and a FIFO cannot stall before its type is rejected.
// Windows retains the existing path chmod because fchmod is unavailable.
export function appendPrivateLine(path: string, line: string, deadlineAtMs?: number): void {
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
    locked = acquireAppendLock(descriptor, deadlineAtMs ?? Date.now() + APPEND_LOCK_DEADLINE_MS);
    if (!locked) throw new Error("private append target is busy");
    const lockedStats = fstatSync(descriptor);
    if (!lockedStats.isFile()) throw new Error("private append target is not a regular file");
    assertBeforeDeadline(deadlineAtMs);
    repairPartialTail(descriptor, path, lockedStats.size);
    const rollbackSize = fstatSync(descriptor).size;
    const bytes = Buffer.from(line);
    let offset = 0;
    try {
      while (offset < bytes.byteLength) {
        assertBeforeDeadline(deadlineAtMs);
        const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
        if (written <= 0) throw new Error("private append made no write progress");
        offset += written;
      }
    } catch (error) {
      truncateOpenFile(descriptor, path, rollbackSize);
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
