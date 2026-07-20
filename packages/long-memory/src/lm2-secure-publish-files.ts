import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { Lm2CleanupError, combineLm2CleanupFailures } from "./lm2-cleanup-errors.js";
import { Lm2Error } from "./lm2-errors.js";
import {
  type AnchoredFile,
  type DirectoryAnchor,
  anchoredChildPath,
  closeAnchoredFile,
  openAnchoredCreateFile,
  sameFileIdentity,
  verifyAnchoredFile,
  verifyDirectoryAnchor,
} from "./lm2-secure-fs.js";
import { readExactAnchoredFile } from "./lm2-secure-read.js";

function directoryDescriptor(anchor: DirectoryAnchor): number {
  const descriptor = anchor.chain.at(-1)?.descriptor;
  if (descriptor === undefined) throw new Lm2Error("write_failed", "LM2 anchor is incomplete.");
  return descriptor;
}

export function materializeAnchoredFile(
  anchor: DirectoryAnchor,
  name: string,
  serialized: string,
): AnchoredFile {
  const file = openAnchoredCreateFile(anchor, name);
  try {
    const bytes = Buffer.from(serialized, "utf8");
    let written = 0;
    while (written < bytes.byteLength) {
      written += writeSync(file.descriptor, bytes, written, bytes.byteLength - written, written);
    }
    fsyncSync(file.descriptor);
    verifyAnchoredFile(file);
    return file;
  } catch (error) {
    try {
      closeAnchoredFile(file);
    } catch (cleanupError) {
      throw new Lm2CleanupError(
        "LM2 materialization cleanup failed.",
        new AggregateError([error, cleanupError], "LM2 materialization and cleanup failed."),
      );
    }
    throw error;
  }
}

export function publishAnchoredTemporary(
  anchor: DirectoryAnchor,
  temp: AnchoredFile,
  finalName: string,
  assertMutationAllowed: () => void,
): void {
  const targetPath = anchoredChildPath(anchor, finalName);
  assertMutationAllowed();
  linkSync(temp.path, targetPath);
  const target = lstatSync(targetPath);
  if (!sameFileIdentity(target, temp.stat)) {
    throw new Lm2Error("write_failed", "LM2 sidecar publication identity changed.");
  }
  fsyncSync(directoryDescriptor(anchor));
  verifyDirectoryAnchor(anchor);
}

export function closeAndRemoveAnchoredTemporary(anchor: DirectoryAnchor, temp: AnchoredFile): void {
  let failure: unknown;
  try {
    closeAnchoredFile(temp);
  } catch (error) {
    failure = error;
  }
  try {
    verifyDirectoryAnchor(anchor);
    unlinkSync(temp.path);
    fsyncSync(directoryDescriptor(anchor));
  } catch (error) {
    failure = combineLm2CleanupFailures(failure, error);
  }
  if (failure !== undefined) throw new Lm2CleanupError("LM2 temporary cleanup failed.", failure);
}

export function unlinkAnchoredFile(anchor: DirectoryAnchor, name: string): void {
  verifyDirectoryAnchor(anchor);
  const path = anchoredChildPath(anchor, name);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Lm2Error("store_corrupt", "LM2 child is not a regular file.");
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!sameFileIdentity(stat, fstatSync(descriptor))) {
        throw new Lm2Error("store_corrupt", "LM2 child identity changed.");
      }
    } finally {
      closeSync(descriptor);
    }
    unlinkSync(path);
    fsyncSync(directoryDescriptor(anchor));
    verifyDirectoryAnchor(anchor);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("store_corrupt", "LM2 child removal is indeterminate.");
  }
}

export function replaceAnchoredFile(
  anchor: DirectoryAnchor,
  name: string,
  serialized: string,
  expectedContentDigest: string,
  maximumBytes: number,
  assertMutationAllowed: () => void,
): ReturnType<typeof readExactAnchoredFile> {
  verifyDirectoryAnchor(anchor);
  const temp = materializeAnchoredFile(anchor, `.${randomUUID()}.replace`, serialized);
  let mutationFailure: unknown;
  let cleanupFailure: unknown;
  let replacement: ReturnType<typeof readExactAnchoredFile> | undefined;
  try {
    assertMutationAllowed();
    renameSync(temp.path, anchoredChildPath(anchor, name));
    fsyncSync(directoryDescriptor(anchor));
    verifyDirectoryAnchor(anchor);
    replacement = readExactAnchoredFile({
      anchor,
      name,
      expectedSerialized: serialized,
      expectedContentDigest,
      maximumBytes,
    });
  } catch (error) {
    mutationFailure = error;
    try {
      unlinkSync(temp.path);
    } catch (unlinkError) {
      if (
        !(unlinkError instanceof Error) ||
        !("code" in unlinkError) ||
        unlinkError.code !== "ENOENT"
      ) {
        cleanupFailure = unlinkError;
      }
    }
  }
  try {
    closeAnchoredFile(temp);
  } catch (error) {
    cleanupFailure = combineLm2CleanupFailures(cleanupFailure, error);
  }
  if (cleanupFailure !== undefined) {
    throw new Lm2CleanupError(
      "LM2 ledger replacement cleanup failed.",
      mutationFailure === undefined
        ? cleanupFailure
        : new AggregateError(
            [mutationFailure, cleanupFailure],
            "LM2 ledger replacement and cleanup failed.",
          ),
    );
  }
  if (mutationFailure instanceof Lm2Error) throw mutationFailure;
  if (mutationFailure !== undefined)
    throw new Lm2Error("write_failed", "LM2 ledger replacement failed.");
  if (replacement === undefined)
    throw new Lm2Error("write_failed", "LM2 ledger replacement result is missing.");
  return replacement;
}
