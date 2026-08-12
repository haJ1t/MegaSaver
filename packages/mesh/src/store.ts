import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ZodType } from "zod";
import { meshPaths } from "./paths.js";

const IS_WIN32 = process.platform === "win32";

export const STALE_AFTER_MS = 90_000;
export const DEAD_AFTER_MS = 10 * 60 * 1000;
export const CLAIM_TTL_MS = 30 * 60 * 1000;
export const HEARTBEAT_DEBOUNCE_MS = 5_000;
export const EVENTS_MAX_BYTES = 5 * 1024 * 1024;
export const EVENTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function atomicWriteFileSync(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tmpPath = join(parentDir, `.${randomUUID()}.tmp`);
  let renamed = false;
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new Error("Store write failed: parent is symlink");
    }
    mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    chmodSync(parentDir, 0o700);
    writeFileSync(tmpPath, content, { mode: 0o600 });
    const fd = openSync(tmpPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, filePath);
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
    if (renamed) return;
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

export function quarantineFileSync(originalPath: string, storeRoot: string): void {
  try {
    const dir = meshPaths(storeRoot).quarantineDir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const dest = join(dir, `${Date.now()}-${basename(originalPath)}`);
    renameSync(originalPath, dest);
  } catch {}
}

export function readJsonOrQuarantine<T>(
  filePath: string,
  schema: ZodType<T>,
  storeRoot: string,
): T | undefined {
  if (!existsSync(filePath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  // torn / empty check
  if (raw.trim() === "") {
    quarantineFileSync(filePath, storeRoot);
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineFileSync(filePath, storeRoot);
    return undefined;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    quarantineFileSync(filePath, storeRoot);
    return undefined;
  }
  return result.data;
}
