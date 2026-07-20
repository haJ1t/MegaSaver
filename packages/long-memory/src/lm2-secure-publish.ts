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
import { Lm2ApprovalTimeoutError } from "./lm2-lock.js";
import type { EmbeddingPort, Lm2Candidate, ModelDescriptor } from "./lm2-model.js";
import { snapshotLm2PortValue } from "./lm2-port-safety.js";
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
export async function approvalBeforeAbort(
  approval: Promise<unknown>,
  signal: AbortSignal,
): Promise<boolean> {
  const settled = approval.then(
    (value) => value === "approved",
    () => false,
  );
  if (signal.aborted) throw new Lm2ApprovalTimeoutError();
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Lm2ApprovalTimeoutError());
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  if (signal.aborted) rejectAbort();
  try {
    return await Promise.race([settled, aborted]);
  } finally {
    signal.removeEventListener("abort", rejectAbort);
  }
}
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
    failure ??= error;
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
  assertMutationAllowed: () => void,
): void {
  verifyDirectoryAnchor(anchor);
  const temp = materializeAnchoredFile(anchor, `.${randomUUID()}.replace`, serialized);
  let mutationFailure: unknown;
  let cleanupFailure: unknown;
  try {
    assertMutationAllowed();
    renameSync(temp.path, anchoredChildPath(anchor, name));
    fsyncSync(directoryDescriptor(anchor));
    verifyDirectoryAnchor(anchor);
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
    cleanupFailure ??= error;
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

export class Lm2CleanupError extends Error {
  readonly entries: readonly Lm2PendingAllocation[];

  constructor(message: string, cause: unknown, entries: readonly Lm2PendingAllocation[] = []) {
    super(message, { cause });
    this.name = "Lm2CleanupError";
    this.entries = [...entries];
  }
}

export function isLm2CleanupError(error: unknown): boolean {
  let current = error;
  const seen = new Set<object>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof Lm2CleanupError) return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
}

function embeddingResult(
  value: unknown,
  fingerprint: string,
  count: number,
): readonly unknown[][] | null {
  const snapshot = snapshotLm2PortValue(value);
  if (snapshot.status === "unreadable") return null;
  const result = snapshot.value;
  if (typeof result !== "object" || result === null) return null;
  const returnedFingerprint = Reflect.get(result, "modelFingerprint");
  const vectors = Reflect.get(result, "vectors");
  return returnedFingerprint === fingerprint && Array.isArray(vectors) && vectors.length === count
    ? vectors
    : null;
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
  let publicationFailure: Lm2PartialPublicationError | undefined;
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
    publicationFailure = new Lm2PartialPublicationError(input.entries, error);
  }
  try {
    closeDirectoryAnchor(namespace);
  } catch (error) {
    throw new Lm2CleanupError(
      "LM2 namespace cleanup failed.",
      publicationFailure === undefined
        ? error
        : new AggregateError([publicationFailure, error], "LM2 publication and cleanup failed."),
      input.entries,
    );
  }
  if (publicationFailure !== undefined) throw publicationFailure;
  return { published, reason: null };
}
