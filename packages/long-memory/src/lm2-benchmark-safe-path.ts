import {
  constants,
  type BigIntStats,
  type Dir,
  type Stats,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
} from "node:fs";
import { BenchmarkTransportError } from "./lm2-benchmark-protocol.js";
import {
  type LosslessFileIdentity,
  hasRequiredMode,
  losslessFileIdentity,
  secureDirectoryOpenFlags,
  secureOpenFlags,
} from "./lm2-secure-fs.js";

export type SafeBenchmarkOpenMode = "directory" | "read" | "update" | "append";
type SafeBenchmarkPathBase = { path: string; stats: Stats; identity: LosslessFileIdentity };
export type SafeBenchmarkDirectoryPath =
  | (SafeBenchmarkPathBase & { descriptor: number; directory: null })
  | (SafeBenchmarkPathBase & { descriptor: null; directory: Dir });
export type SafeBenchmarkFilePath = SafeBenchmarkPathBase & {
  descriptor: number;
  directory: null;
};
export type SafeBenchmarkPath = SafeBenchmarkDirectoryPath | SafeBenchmarkFilePath;

export function benchmarkFileOpenFlags(
  mode: Exclude<SafeBenchmarkOpenMode, "directory">,
  platform: NodeJS.Platform = process.platform,
): number {
  const access =
    mode === "update"
      ? constants.O_RDWR
      : mode === "append"
        ? constants.O_WRONLY | constants.O_APPEND
        : constants.O_RDONLY;
  return secureOpenFlags((platform === "win32" ? 0 : constants.O_NONBLOCK) | access, platform);
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function hasExactIdentity(stats: BigIntStats, expected: LosslessFileIdentity): boolean {
  const identity = losslessFileIdentity(stats);
  return identity.device === expected.device && identity.inode === expected.inode;
}

function sameExactIdentity(left: LosslessFileIdentity, right: LosslessFileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function verifySafeBenchmarkPath(
  value: SafeBenchmarkPath,
  mode: SafeBenchmarkOpenMode,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    const descriptorStats =
      value.descriptor === null ? lstatSync(value.path) : fstatSync(value.descriptor);
    const pathStats = lstatSync(value.path);
    const descriptorIdentity =
      value.descriptor === null
        ? lstatSync(value.path, { bigint: true })
        : fstatSync(value.descriptor, { bigint: true });
    const pathIdentity = lstatSync(value.path, { bigint: true });
    const directory = mode === "directory";
    const kindMatches = directory ? descriptorStats.isDirectory() : descriptorStats.isFile();
    const ownerMatches =
      typeof process.geteuid !== "function" || descriptorStats.uid === process.geteuid();
    if (
      !kindMatches ||
      (!directory && descriptorStats.nlink !== 1) ||
      !sameIdentity(descriptorStats, value.stats) ||
      !sameIdentity(pathStats, value.stats) ||
      !hasExactIdentity(descriptorIdentity, value.identity) ||
      !hasExactIdentity(pathIdentity, value.identity) ||
      pathStats.isSymbolicLink() ||
      !hasRequiredMode(descriptorStats.mode, directory ? 0o700 : 0o600, platform) ||
      !ownerMatches
    ) {
      throw new BenchmarkTransportError("state_rejected");
    }
  } catch (error) {
    if (error instanceof BenchmarkTransportError) throw error;
    throw new BenchmarkTransportError("state_rejected");
  }
}

export function openSafeBenchmarkPath(
  path: string,
  mode: "directory",
  platform?: NodeJS.Platform,
): SafeBenchmarkDirectoryPath;
export function openSafeBenchmarkPath(
  path: string,
  mode: Exclude<SafeBenchmarkOpenMode, "directory">,
  platform?: NodeJS.Platform,
): SafeBenchmarkFilePath;
export function openSafeBenchmarkPath(
  path: string,
  mode: SafeBenchmarkOpenMode,
  platform: NodeJS.Platform = process.platform,
): SafeBenchmarkPath {
  if (mode === "directory" && platform === "win32") {
    let directory: Dir | undefined;
    try {
      const before = lstatSync(path);
      if (!before.isDirectory() || before.isSymbolicLink()) {
        throw new BenchmarkTransportError("state_rejected");
      }
      const beforeIdentity = losslessFileIdentity(lstatSync(path, { bigint: true }));
      directory = opendirSync(path);
      const afterIdentity = losslessFileIdentity(lstatSync(path, { bigint: true }));
      if (!sameExactIdentity(beforeIdentity, afterIdentity)) {
        throw new BenchmarkTransportError("state_rejected");
      }
      const value: SafeBenchmarkDirectoryPath = {
        path,
        descriptor: null,
        directory,
        stats: before,
        identity: beforeIdentity,
      };
      verifySafeBenchmarkPath(value, mode, platform);
      return value;
    } catch (error) {
      directory?.closeSync();
      if (error instanceof BenchmarkTransportError) throw error;
      throw new BenchmarkTransportError("state_rejected");
    }
  }
  let descriptor: number;
  try {
    const flags =
      mode === "directory"
        ? secureDirectoryOpenFlags(platform)
        : benchmarkFileOpenFlags(mode, platform);
    descriptor = openSync(path, flags);
  } catch {
    throw new BenchmarkTransportError("state_rejected");
  }
  let value: SafeBenchmarkPath;
  try {
    value = {
      path,
      descriptor,
      directory: null,
      stats: fstatSync(descriptor),
      identity: losslessFileIdentity(fstatSync(descriptor, { bigint: true })),
    };
    verifySafeBenchmarkPath(value, mode, platform);
    return value;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function closeSafeBenchmarkPath(value: SafeBenchmarkPath): void {
  if (value.descriptor === null) {
    value.directory.closeSync();
    return;
  }
  closeSync(value.descriptor);
}
