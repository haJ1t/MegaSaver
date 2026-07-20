import { createHash, randomUUID } from "node:crypto";
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
import { Lm2Error } from "./lm2-errors.js";
import type { EmbeddingPort, Lm2Candidate, ModelDescriptor } from "./lm2-model.js";
import type { Lm2PendingAllocation } from "./lm2-quota-ledger.js";
import {
  type AnchoredFile,
  type DirectoryAnchor,
  anchoredChildPath,
  closeAnchoredFile,
  closeDirectoryAnchor,
  openAnchoredCreateFile,
  sameFileIdentity,
  verifyAnchoredFile,
  verifyDirectoryAnchor,
} from "./lm2-secure-fs.js";
import { buildSerializedSidecar, canonicalEmbeddingInput } from "./lm2-vector-format.js";
import { ensureVectorNamespace } from "./lm2-vector-paths.js";

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
    closeAnchoredFile(file);
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
  closeAnchoredFile(temp);
  try {
    verifyDirectoryAnchor(anchor);
    unlinkSync(temp.path);
    fsyncSync(directoryDescriptor(anchor));
  } catch {
    // Recovery owns the exact named temporary path if cleanup is interrupted.
  }
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
  assertMutationAllowed: () => void,
): void {
  verifyDirectoryAnchor(anchor);
  const temp = materializeAnchoredFile(anchor, `.${randomUUID()}.replace`, serialized);
  try {
    assertMutationAllowed();
    renameSync(temp.path, anchoredChildPath(anchor, name));
    fsyncSync(directoryDescriptor(anchor));
    verifyDirectoryAnchor(anchor);
  } catch (error) {
    try {
      unlinkSync(temp.path);
    } catch {
      // Rename may already have made the replacement durable.
    }
    if (error instanceof Lm2Error) throw error;
    throw new Lm2Error("write_failed", "LM2 ledger replacement failed.");
  } finally {
    closeAnchoredFile(temp);
  }
}

type PublishedProbe =
  | { status: "missing" | "invalid" }
  | { status: "valid"; digest: string; serializedBytes: number };

export class Lm2PartialPublicationError extends Error {
  readonly entries: readonly Lm2PendingAllocation[];

  constructor(entries: readonly Lm2PendingAllocation[], cause: unknown) {
    super("LM2 batch publication failed after a committed prefix.", { cause });
    this.name = "Lm2PartialPublicationError";
    this.entries = [...entries];
  }
}

function embeddingResult(
  value: unknown,
  fingerprint: string,
  count: number,
): readonly unknown[][] | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    const returnedFingerprint = Reflect.get(value, "modelFingerprint");
    const vectors = Reflect.get(value, "vectors");
    return returnedFingerprint === fingerprint && Array.isArray(vectors) && vectors.length === count
      ? vectors
      : null;
  } catch {
    return null;
  }
}

export async function publishLm2ReservedBatch(input: {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  fingerprint: string;
  records: readonly Lm2Candidate[];
  entries: readonly Lm2PendingAllocation[];
  ledgerEpoch: string;
  signal: AbortSignal;
  deadlineAtMs: number;
  now(): number;
  embed: EmbeddingPort["embed"];
  assertEgressAllowed(): Promise<boolean>;
  recheckEvidence(record: Lm2Candidate): Promise<boolean>;
  assertGuard(): void;
  settlePending(): void;
  persistMaterialized(entries: Lm2PendingAllocation[]): void;
  currentEntry(): Lm2PendingAllocation | undefined;
  inspectPublished(entry: Lm2PendingAllocation): PublishedProbe;
  commitFirst(): void;
}): Promise<{
  published: string[];
  reason: null | "invalid_vectors" | "port_failure" | "remote_approval_denied" | "evidence_changed";
}> {
  const published: string[] = [];
  if (!(await input.assertEgressAllowed())) {
    input.settlePending();
    return { published, reason: "remote_approval_denied" };
  }
  try {
    input.assertGuard();
  } catch {
    input.settlePending();
    return { published, reason: "port_failure" };
  }
  let portResult: unknown;
  try {
    portResult = await input.embed({
      model: input.model,
      purpose: "document",
      texts: input.records.map(canonicalEmbeddingInput),
      signal: input.signal,
    });
  } catch {
    input.settlePending();
    return { published, reason: "port_failure" };
  }
  if (input.signal.aborted || input.now() >= input.deadlineAtMs) {
    input.settlePending();
    return { published, reason: "port_failure" };
  }
  const result = embeddingResult(portResult, input.fingerprint, input.records.length);
  if (result === null) {
    input.settlePending();
    return { published, reason: "invalid_vectors" };
  }
  const serialized = input.records.map((record, index) =>
    buildSerializedSidecar(input.model, record, result[index] ?? [], {
      ledgerEpoch: input.ledgerEpoch,
      allocationSequence: input.entries[index]?.allocationSequence ?? 0,
    }),
  );
  const materialized = input.entries.map((entry, index): Lm2PendingAllocation => {
    const content = serialized[index];
    if (content === undefined) throw new Lm2Error("write_failed", "LM2 batch order changed.");
    return {
      ...entry,
      expectedSidecarDigest: createHash("sha256").update(content).digest("hex"),
      serializedBytes: Buffer.byteLength(content, "utf8"),
      phase: "materialized",
    };
  });
  input.persistMaterialized(materialized);
  const namespace = ensureVectorNamespace(input.storeRoot, input.workspaceKey, input.model);
  try {
    for (let index = 0; index < input.records.length; index += 1) {
      const record = input.records[index];
      const entry = input.currentEntry();
      const content = serialized[index];
      if (record === undefined || entry === undefined || content === undefined) {
        throw new Lm2Error("write_failed", "LM2 pending order changed.");
      }
      input.assertGuard();
      const temp = materializeAnchoredFile(namespace, entry.temporaryName, content);
      let eligible = false;
      try {
        eligible = await input.recheckEvidence(record);
      } catch {
        eligible = false;
      }
      if (!eligible) {
        closeAndRemoveAnchoredTemporary(namespace, temp);
        input.settlePending();
        return { published, reason: "evidence_changed" };
      }
      try {
        publishAnchoredTemporary(namespace, temp, entry.finalName, input.assertGuard);
      } finally {
        closeAndRemoveAnchoredTemporary(namespace, temp);
      }
      const verified = input.inspectPublished(entry);
      if (
        verified.status !== "valid" ||
        verified.digest !== entry.expectedSidecarDigest ||
        verified.serializedBytes !== entry.serializedBytes
      ) {
        throw new Lm2Error("write_failed", "LM2 publication verification failed.");
      }
      input.commitFirst();
      published.push(record.id);
    }
  } catch (error) {
    throw new Lm2PartialPublicationError(input.entries, error);
  } finally {
    closeDirectoryAnchor(namespace);
  }
  return { published, reason: null };
}
