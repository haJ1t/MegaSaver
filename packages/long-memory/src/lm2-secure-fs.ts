import {
  constants,
  type Stats,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, join, parse, relative, sep } from "node:path";
import { combineLm2CleanupFailures } from "./lm2-cleanup-errors.js";
import { canonicalDirectoryAnchorPath } from "./lm2-directory-anchor-path.js";
import { Lm2Error } from "./lm2-errors.js";
import { secureDirectoryOpenFlags, secureOpenFlags } from "./lm2-fs-platform.js";

export {
  hasRequiredMode,
  losslessFileIdentity,
  secureDirectoryOpenFlags,
  secureOpenFlags,
  syncDirectoryAnchor,
  syncDirectoryDescriptor,
} from "./lm2-fs-platform.js";
export type { LosslessFileIdentity } from "./lm2-fs-platform.js";

type AnchoredIdentity = { path: string; descriptor: number; stat: Stats };

export type DirectoryAnchor = {
  path: string;
  chain: readonly AnchoredIdentity[];
};

export type AnchoredFile = {
  path: string;
  descriptor: number;
  stat: Stats;
  parent: DirectoryAnchor;
  ownsParent: boolean;
};

export type BoundedFileRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; raw: Buffer; stat: Stats };

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function verifiedLstat(path: string, expected: Stats): void {
  let actual: Stats | undefined;
  try {
    actual = lstatSync(path);
  } catch {
    throw new Lm2Error("store_corrupt", "LM2 filesystem identity changed.");
  }
  if (actual === undefined || !sameFileIdentity(actual, expected)) {
    throw new Lm2Error("store_corrupt", "LM2 filesystem identity changed.");
  }
}

function closeDescriptors(chain: readonly AnchoredIdentity[]): void {
  let failure: unknown;
  for (const entry of [...chain].reverse()) {
    try {
      closeSync(entry.descriptor);
    } catch (error) {
      failure = combineLm2CleanupFailures(failure, error);
    }
  }
  if (failure !== undefined) {
    throw new Lm2Error("store_corrupt", "LM2 directory descriptor close failed.", {
      cause: failure,
    });
  }
}

export function openDirectoryAnchor(path: string, allowMissing: boolean): DirectoryAnchor | null {
  const absolute = canonicalDirectoryAnchorPath(path);
  const root = parse(absolute).root;
  const paths = [
    root,
    ...relative(root, absolute)
      .split(sep)
      .filter(Boolean)
      .map((_, index, segments) => join(root, ...segments.slice(0, index + 1))),
  ];
  const chain: AnchoredIdentity[] = [];
  try {
    for (const current of paths) {
      let descriptor: number;
      try {
        descriptor = openSync(current, secureDirectoryOpenFlags());
      } catch (error) {
        if (allowMissing && errorCode(error) === "ENOENT") {
          closeDescriptors(chain);
          return null;
        }
        throw error;
      }
      const stat = fstatSync(descriptor);
      if (!stat.isDirectory()) {
        closeSync(descriptor);
        throw new Lm2Error("store_corrupt", "LM2 directory path is invalid.");
      }
      verifiedLstat(current, stat);
      chain.push({ path: current, descriptor, stat });
    }
    const anchor = { path: absolute, chain };
    verifyDirectoryAnchor(anchor);
    return anchor;
  } catch (error) {
    try {
      closeDescriptors(chain);
    } catch {
      // The original identity/open failure is the actionable boundary error.
    }
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 directory path is unavailable.");
  }
}

export function verifyDirectoryAnchor(anchor: DirectoryAnchor): void {
  for (const entry of anchor.chain) {
    const current = fstatSync(entry.descriptor);
    if (!current.isDirectory() || !sameFileIdentity(current, entry.stat)) {
      throw new Lm2Error("store_corrupt", "LM2 directory descriptor changed.");
    }
    verifiedLstat(entry.path, entry.stat);
  }
}

export function closeDirectoryAnchor(anchor: DirectoryAnchor): void {
  closeDescriptors(anchor.chain);
}

export function listAnchoredDirectory(anchor: DirectoryAnchor): string[] {
  try {
    verifyDirectoryAnchor(anchor);
    const names = readdirSync(anchor.path);
    verifyDirectoryAnchor(anchor);
    return names;
  } catch (error) {
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 directory traversal is indeterminate.");
  }
}

export function anchoredDirectoryIsEmpty(anchor: DirectoryAnchor): boolean {
  verifyDirectoryAnchor(anchor);
  const directory = opendirSync(anchor.path);
  try {
    const empty = directory.readSync() === null;
    verifyDirectoryAnchor(anchor);
    return empty;
  } catch (error) {
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 directory probe is indeterminate.");
  } finally {
    directory.closeSync();
  }
}

export function anchoredChildPath(anchor: DirectoryAnchor, name: string): string {
  if (basename(name) !== name || name === "." || name === "..") {
    throw new Lm2Error("store_corrupt", "LM2 child path is invalid.");
  }
  return join(anchor.path, name);
}

function openRegularChild(
  anchor: DirectoryAnchor,
  name: string,
  flags: number,
  mode?: number,
): AnchoredFile {
  verifyDirectoryAnchor(anchor);
  const path = anchoredChildPath(anchor, name);
  const descriptor = openSync(path, secureOpenFlags(flags), mode);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Lm2Error("store_corrupt", "LM2 child is not a regular file.");
    verifiedLstat(path, stat);
    verifyDirectoryAnchor(anchor);
    return { path, descriptor, stat, parent: anchor, ownsParent: false };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function openAnchoredUpdateFile(path: string): AnchoredFile {
  const parent = openDirectoryAnchor(dirname(path), false);
  if (parent === null) throw new Lm2Error("store_corrupt", "LM2 lock parent is missing.");
  try {
    const file = openRegularChild(
      parent,
      basename(path),
      constants.O_RDWR | constants.O_CREAT,
      0o600,
    );
    return { ...file, ownsParent: true };
  } catch (error) {
    closeDirectoryAnchor(parent);
    throw error;
  }
}

export function openAnchoredCreateFile(anchor: DirectoryAnchor, name: string): AnchoredFile {
  return openRegularChild(
    anchor,
    name,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
}

export function verifyAnchoredFile(file: AnchoredFile): void {
  const current = fstatSync(file.descriptor);
  if (!current.isFile() || !sameFileIdentity(current, file.stat)) {
    throw new Lm2Error("store_corrupt", "LM2 file descriptor changed.");
  }
  verifiedLstat(file.path, file.stat);
  verifyDirectoryAnchor(file.parent);
}

export function closeAnchoredFile(file: AnchoredFile): void {
  let failure: unknown;
  try {
    closeSync(file.descriptor);
  } catch (error) {
    failure = error;
  }
  if (file.ownsParent) {
    try {
      closeDirectoryAnchor(file.parent);
    } catch (error) {
      failure = combineLm2CleanupFailures(failure, error);
    }
  }
  if (failure !== undefined) {
    throw new Lm2Error("store_corrupt", "LM2 file descriptor close failed.", { cause: failure });
  }
}

export function readAnchoredFile(
  anchor: DirectoryAnchor,
  name: string,
  maximumBytes: number,
): BoundedFileRead {
  let file: AnchoredFile;
  try {
    file = openRegularChild(anchor, name, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { status: "missing" };
    if (code === "ELOOP" || code === "EISDIR" || error instanceof Lm2Error) {
      if (error instanceof Lm2Error && error.message !== "LM2 child is not a regular file.") {
        throw error;
      }
      return { status: "invalid" };
    }
    throw new Lm2Error("store_corrupt", "LM2 sidecar read is indeterminate.");
  }
  try {
    if (file.stat.size <= 0 || file.stat.size > maximumBytes) return { status: "invalid" };
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximumBytes) {
      const chunk = Buffer.alloc(Math.min(8_192, maximumBytes + 1 - total));
      const count = readSync(file.descriptor, chunk, 0, chunk.length, total);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    const finalStat = fstatSync(file.descriptor);
    if (!sameFileIdentity(finalStat, file.stat) || finalStat.size !== file.stat.size) {
      throw new Lm2Error("store_corrupt", "LM2 sidecar changed during read.");
    }
    verifyAnchoredFile(file);
    if (total !== file.stat.size) {
      throw new Lm2Error("store_corrupt", "LM2 sidecar read is indeterminate.");
    }
    if (total > maximumBytes) return { status: "invalid" };
    return { status: "valid", raw: Buffer.concat(chunks, total), stat: file.stat };
  } catch (error) {
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 sidecar read is indeterminate.");
  } finally {
    closeAnchoredFile(file);
  }
}
