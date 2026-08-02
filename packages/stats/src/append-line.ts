import {
  constants,
  chmodSync,
  closeSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

const IS_WIN32 = process.platform === "win32";
const APPEND_LOCK_DEADLINE_MS = 500;
const APPEND_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

type AppendLockOwner = {
  pid: number;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function readAppendLockOwner(path: string): AppendLockOwner | undefined {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
    return { pid };
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

function reclaimDeadAppendLock(path: string): boolean {
  const owner = readAppendLockOwner(path);
  if (owner === undefined || isProcessAlive(owner.pid)) return false;
  const reclaimPath = `${path}.reclaim`;
  try {
    writeFileSync(reclaimPath, "", { flag: "wx", mode: 0o600 });
  } catch {
    return false;
  }
  try {
    const confirmedOwner = readAppendLockOwner(path);
    if (confirmedOwner === undefined || isProcessAlive(confirmedOwner.pid)) return false;
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(reclaimPath, { force: true });
  }
}

function withAppendLock(path: string, operation: () => void): boolean {
  const deadline = Date.now() + APPEND_LOCK_DEADLINE_MS;
  for (;;) {
    try {
      writeFileSync(path, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (reclaimDeadAppendLock(path)) continue;
      if (Date.now() >= deadline) return false;
      Atomics.wait(APPEND_LOCK_WAIT, 0, 0, 10);
    }
  }
  try {
    operation();
    return true;
  } finally {
    rmSync(path, { force: true });
  }
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
  const appended = withAppendLock(`${path}.lock`, () => {
    const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT;
    const descriptor = openSync(
      path,
      IS_WIN32 ? flags : flags | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      const stats = fstatSync(descriptor);
      if (!stats.isFile()) {
        throw new Error("private append target is not a regular file");
      }
      if (IS_WIN32) chmodSync(path, 0o600);
      else fchmodSync(descriptor, 0o600);
      const bytes = Buffer.from(line);
      let offset = 0;
      try {
        while (offset < bytes.byteLength) {
          const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
          if (written <= 0) throw new Error("private append made no write progress");
          offset += written;
        }
      } catch (error) {
        ftruncateSync(descriptor, stats.size);
        throw error;
      }
    } finally {
      closeSync(descriptor);
    }
  });
  if (!appended) throw new Error("private append target is busy");
}
