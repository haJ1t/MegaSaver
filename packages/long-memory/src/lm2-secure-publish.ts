import { randomUUID } from "node:crypto";
import { fsyncSync, linkSync, lstatSync, unlinkSync, writeSync } from "node:fs";
import { Lm2Error } from "./lm2-errors.js";
import {
  type DirectoryAnchor,
  anchoredChildPath,
  closeAnchoredFile,
  openAnchoredCreateFile,
  sameFileIdentity,
  verifyAnchoredFile,
  verifyDirectoryAnchor,
} from "./lm2-secure-fs.js";

export function writeAnchoredNoClobber(
  anchor: DirectoryAnchor,
  name: string,
  serialized: string,
  assertMutationAllowed: () => void,
): void {
  verifyDirectoryAnchor(anchor);
  const temp = openAnchoredCreateFile(anchor, `.${randomUUID()}.tmp`);
  try {
    const bytes = Buffer.from(serialized, "utf8");
    let written = 0;
    while (written < bytes.byteLength) {
      written += writeSync(temp.descriptor, bytes, written, bytes.byteLength - written, written);
    }
    fsyncSync(temp.descriptor);
    verifyAnchoredFile(temp);
    const targetPath = anchoredChildPath(anchor, name);
    assertMutationAllowed();
    linkSync(temp.path, targetPath);
    const target = lstatSync(targetPath);
    if (target === undefined || !sameFileIdentity(target, temp.stat)) {
      throw new Lm2Error("write_failed", "LM2 sidecar publication identity changed.");
    }
    verifyDirectoryAnchor(anchor);
    fsyncSync(anchor.chain.at(-1)?.descriptor as number);
  } catch (error) {
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("write_failed", "LM2 vector sidecar publication failed.");
  } finally {
    closeAnchoredFile(temp);
    try {
      verifyDirectoryAnchor(anchor);
      unlinkSync(temp.path);
      fsyncSync(anchor.chain.at(-1)?.descriptor as number);
    } catch {
      // An ambiguous parent is left untouched rather than risking deletion outside the anchor.
    }
  }
}
