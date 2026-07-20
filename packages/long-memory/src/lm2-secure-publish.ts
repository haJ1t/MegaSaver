import { createHash } from "node:crypto";
import { Lm2CleanupError } from "./lm2-cleanup-errors.js";
import { Lm2Error } from "./lm2-errors.js";
import { Lm2ApprovalTimeoutError } from "./lm2-lock.js";
import type { EmbeddingPort, Lm2Candidate, ModelDescriptor } from "./lm2-model.js";
import { snapshotLm2PortValue } from "./lm2-port-safety.js";
import type { Lm2PendingAllocation } from "./lm2-quota-ledger.js";
import { closeDirectoryAnchor } from "./lm2-secure-fs.js";
import {
  closeAndRemoveAnchoredTemporary,
  materializeAnchoredFile,
  publishAnchoredTemporary,
} from "./lm2-secure-publish-files.js";
import { buildSerializedSidecar, canonicalEmbeddingInput } from "./lm2-vector-format.js";
import { ensureVectorNamespace } from "./lm2-vector-paths.js";

export { Lm2CleanupError, isLm2CleanupError } from "./lm2-cleanup-errors.js";
export {
  closeAndRemoveAnchoredTemporary,
  materializeAnchoredFile,
  publishAnchoredTemporary,
  replaceAnchoredFile,
  unlinkAnchoredFile,
} from "./lm2-secure-publish-files.js";
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
