import { constants, type Stats, closeSync, fstatSync, lstatSync, openSync } from "node:fs";
import { BenchmarkTransportError } from "./lm2-benchmark-protocol.js";
import { hasRequiredMode, secureDirectoryOpenFlags, secureOpenFlags } from "./lm2-secure-fs.js";

export type SafeBenchmarkPath = { path: string; descriptor: number; stats: Stats };
export type SafeBenchmarkOpenMode = "directory" | "read" | "update" | "append";

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

export function verifySafeBenchmarkPath(
  value: SafeBenchmarkPath,
  mode: SafeBenchmarkOpenMode,
): void {
  try {
    const descriptorStats = fstatSync(value.descriptor);
    const pathStats = lstatSync(value.path);
    const directory = mode === "directory";
    const kindMatches = directory ? descriptorStats.isDirectory() : descriptorStats.isFile();
    const ownerMatches =
      typeof process.geteuid !== "function" || descriptorStats.uid === process.geteuid();
    if (
      !kindMatches ||
      (!directory && descriptorStats.nlink !== 1) ||
      !sameIdentity(descriptorStats, value.stats) ||
      !sameIdentity(pathStats, value.stats) ||
      pathStats.isSymbolicLink() ||
      !hasRequiredMode(descriptorStats.mode, directory ? 0o700 : 0o600) ||
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
  mode: SafeBenchmarkOpenMode,
): SafeBenchmarkPath {
  let descriptor: number;
  try {
    const flags =
      mode === "directory"
        ? secureDirectoryOpenFlags()
        : secureOpenFlags(
            constants.O_NONBLOCK |
              (mode === "update"
                ? constants.O_RDWR
                : mode === "append"
                  ? constants.O_WRONLY | constants.O_APPEND
                  : constants.O_RDONLY),
          );
    descriptor = openSync(path, flags);
  } catch {
    throw new BenchmarkTransportError("state_rejected");
  }
  let value: SafeBenchmarkPath;
  try {
    value = { path, descriptor, stats: fstatSync(descriptor) };
    verifySafeBenchmarkPath(value, mode);
    return value;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}
