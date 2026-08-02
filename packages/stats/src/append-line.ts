import {
  constants,
  chmodSync,
  closeSync,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

const IS_WIN32 = process.platform === "win32";

// Every JSONL under the store is owner-only: the event stream reveals what the
// agent read and ran, and it sits beside the captured prompt. The chmods are
// backstops for existing paths; POSIX binds the file mode and write to the same
// no-follow descriptor so a stable final symlink cannot escape the private
// store. Windows retains the existing path chmod because fchmod is unavailable.
export function appendPrivateLine(path: string, line: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT;
  const descriptor = openSync(path, IS_WIN32 ? flags : flags | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error("private append target is not a regular file");
    }
    if (IS_WIN32) chmodSync(path, 0o600);
    else fchmodSync(descriptor, 0o600);
    writeSync(descriptor, line);
  } finally {
    closeSync(descriptor);
  }
}
