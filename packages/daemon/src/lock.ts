import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { lockPath } from "./paths.js";

// Exclusive create ("wx") is the singleton primitive: only one process wins the
// race to create the lock file; everyone else gets EEXIST → null. A stale lock
// from a crashed daemon is reaped by the client (it pings discovery; a dead
// daemon means the client clears discovery + lock before spawning).
export function acquireLock(storeRoot: string): (() => void) | null {
  const path = lockPath(storeRoot);
  mkdirSync(dirname(path), { recursive: true });
  try {
    closeSync(openSync(path, "wx"));
  } catch {
    return null;
  }
  return () => rmSync(path, { force: true });
}

export function clearLock(storeRoot: string): void {
  rmSync(lockPath(storeRoot), { force: true });
}
