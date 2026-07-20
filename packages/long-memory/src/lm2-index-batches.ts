import { canonicalFloat32, modelDescriptorFingerprint } from "./lm2-identity.js";
import {
  type Lm2AdmittedIndexRecord,
  isOrderedCanonicalProjectionSubset,
} from "./lm2-index-admission.js";
import type { Lm2ReadyIndexOperation } from "./lm2-lock.js";
import type {
  EmbeddingPort,
  Lm2IndexReceipt,
  ModelDescriptor,
  RemoteEmbeddingApprovalPort,
} from "./lm2-model.js";
import { canonicalEmbeddingInput } from "./lm2-vector-format.js";

export type Lm2PendingIndexRecord = Lm2AdmittedIndexRecord & {
  cursorBefore: string | null;
  cursorAfter: string | null;
};

export type Lm2IndexBatchResult = {
  publishedIds: readonly string[];
  omissions: readonly { id: string; reason: string }[];
  retryCursor: string | null;
  transientReason:
    | null
    | "remote_approval_denied"
    | "embedding_failure"
    | "timeout"
    | "sidecar_write_failed"
    | "evidence_changed"
    | "lock_integrity_lost";
};

type BatchTransientReason = Exclude<Lm2IndexBatchResult["transientReason"], null>;

type QuotaRecovery = Lm2IndexReceipt["quotaRecovery"];
type RetryReason = Extract<Lm2IndexReceipt, { outcome: "retry" }>["transientReason"];

export function retryIndexReceipt(input: {
  indexedCount?: number;
  omitted?: readonly { id: string; reason: string }[];
  retryCursor: string | null;
  reason: RetryReason;
  quotaRecovery: QuotaRecovery;
}): Lm2IndexReceipt {
  return {
    indexedCount: input.indexedCount ?? 0,
    omitted: [...(input.omitted ?? [])],
    outcome: "retry",
    nextCursor: null,
    retryCursor: input.retryCursor,
    transientReason: input.reason,
    quotaRecovery: input.quotaRecovery,
  };
}

export function terminalIndexReceipt(input: {
  indexedCount: number;
  omitted: readonly { id: string; reason: string }[];
  nextCursor: string | null;
  quotaRecovery: QuotaRecovery;
}): Lm2IndexReceipt {
  const fields = {
    indexedCount: input.indexedCount,
    omitted: [...input.omitted],
    retryCursor: null,
    transientReason: null,
    quotaRecovery: input.quotaRecovery,
  };
  return input.nextCursor === null
    ? { ...fields, outcome: "complete", nextCursor: null }
    : { ...fields, outcome: "continue", nextCursor: input.nextCursor };
}

export function expiredIndexReceipt(quotaRecovery: QuotaRecovery): Lm2IndexReceipt {
  return {
    indexedCount: 0,
    omitted: [],
    outcome: "expired",
    nextCursor: null,
    retryCursor: null,
    transientReason: null,
    quotaRecovery,
  };
}

function sameModel(left: ModelDescriptor, right: ModelDescriptor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePortResult(
  value: unknown,
  fingerprint: string,
  count: number,
  dimensions: number,
): { modelFingerprint: string; vectors: readonly (readonly number[])[] } {
  if (typeof value !== "object" || value === null) throw new Error("invalid embedding result");
  const keys = Reflect.ownKeys(value);
  const fingerprintField = Reflect.getOwnPropertyDescriptor(value, "modelFingerprint");
  const vectorsField = Reflect.getOwnPropertyDescriptor(value, "vectors");
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "modelFingerprint" && key !== "vectors") ||
    fingerprintField === undefined ||
    vectorsField === undefined ||
    !fingerprintField.enumerable ||
    !vectorsField.enumerable ||
    !("value" in fingerprintField) ||
    !("value" in vectorsField)
  )
    throw new Error("invalid embedding result");
  const returnedFingerprint: unknown = fingerprintField.value;
  const returnedVectors: unknown = vectorsField.value;
  if (returnedFingerprint !== fingerprint || !Array.isArray(returnedVectors)) {
    throw new Error("invalid embedding result");
  }
  if (returnedVectors.length !== count) throw new Error("invalid embedding count");
  const vectors: number[][] = [];
  for (const value of returnedVectors) {
    if (
      !Array.isArray(value) ||
      value.length !== dimensions ||
      value.some((component) => typeof component !== "number" || !Number.isFinite(component))
    ) {
      throw new Error("invalid embedding vector");
    }
    vectors.push([...canonicalFloat32(value)]);
  }
  return { modelFingerprint: fingerprint, vectors };
}

function transientReason(
  reason: Exclude<Awaited<ReturnType<Lm2ReadyIndexOperation["publishBatch"]>>["reason"], null>,
  timedOut: boolean,
): Exclude<Lm2IndexBatchResult["transientReason"], null> {
  if (timedOut) return "timeout";
  switch (reason) {
    case "remote_approval_denied":
      return "remote_approval_denied";
    case "port_failure":
    case "invalid_vectors":
      return "embedding_failure";
    case "write_failed":
      return "sidecar_write_failed";
    case "evidence_changed":
      return "evidence_changed";
    case "lock_integrity_lost":
      return "lock_integrity_lost";
    case "storage_limit":
      throw new Error("storage limit is terminal");
  }
}

function retryPosition(
  records: readonly Lm2PendingIndexRecord[],
  committed: ReadonlySet<string>,
  pageOrigin: string | null,
): string | null {
  return records.find((record) => !committed.has(record.candidate.id))?.cursorBefore ?? pageOrigin;
}

function transientBatchResult(
  publishedIds: readonly string[],
  omissions: readonly { id: string; reason: string }[],
  retryCursor: string | null,
  transientReason: BatchTransientReason,
): Lm2IndexBatchResult {
  return { publishedIds, omissions, retryCursor, transientReason };
}

export async function publishLm2IndexBatch(input: {
  operation: Lm2ReadyIndexOperation;
  records: readonly Lm2PendingIndexRecord[];
  model: ModelDescriptor;
  embedding: EmbeddingPort;
  workspaceKey: string;
  signal: AbortSignal;
  pageOrigin: string | null;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  recheckEvidence(record: Lm2PendingIndexRecord["candidate"]): Promise<boolean>;
}): Promise<Lm2IndexBatchResult> {
  const fingerprint = modelDescriptorFingerprint(input.model);
  const expectedTexts = input.records.map(({ candidate }) => canonicalEmbeddingInput(candidate));
  const expectedIds = new Set(input.records.map(({ candidate }) => candidate.id));
  const work = input.operation.publishBatch({
    records: input.records.map(({ candidate }) => candidate),
    assertEgressAllowed: async () => {
      if (input.embedding.egress === "local") return true;
      if (input.remoteApproval === undefined || input.approvalRef === undefined) return false;
      try {
        return (
          (await input.remoteApproval.assertCurrent({
            workspaceKey: input.workspaceKey,
            modelFingerprint: fingerprint,
            purpose: "document",
            approvalRef: input.approvalRef,
          })) === "approved"
        );
      } catch {
        return false;
      }
    },
    recheckEvidence: input.recheckEvidence,
    embed: async (call) => {
      if (
        input.signal.aborted ||
        call.signal !== input.signal ||
        call.purpose !== "document" ||
        !sameModel(call.model, input.model) ||
        !isOrderedCanonicalProjectionSubset(expectedTexts, call.texts)
      ) {
        throw new Error("unbound embedding call");
      }
      const result: unknown = await input.embedding.embed({
        model: input.model,
        purpose: "document",
        texts: [...call.texts],
        signal: input.signal,
      });
      if (input.signal.aborted) throw new Error("expired embedding result");
      return validatePortResult(result, fingerprint, call.texts.length, input.model.dimensions);
    },
  });
  let result: Awaited<ReturnType<Lm2ReadyIndexOperation["publishBatch"]>>;
  try {
    result = await work;
  } catch {
    return transientBatchResult(
      [],
      [],
      input.records[0]?.cursorBefore ?? input.pageOrigin,
      input.signal.aborted ? "timeout" : "sidecar_write_failed",
    );
  }
  const published = new Set(result.published);
  const existing = new Set(result.existing);
  if (
    published.size !== result.published.length ||
    existing.size !== result.existing.length ||
    result.published.some((id) => !expectedIds.has(id) || existing.has(id)) ||
    result.existing.some((id) => !expectedIds.has(id))
  ) {
    return transientBatchResult(
      [],
      [],
      input.records[0]?.cursorBefore ?? input.pageOrigin,
      "sidecar_write_failed",
    );
  }
  const committed = new Set([...published, ...existing]);
  const existingOmissions = input.records
    .filter(({ candidate }) => existing.has(candidate.id))
    .map(({ candidate }) => ({ id: candidate.id, reason: "already_indexed" }));
  const uncommitted = input.records.filter(({ candidate }) => !committed.has(candidate.id));
  if (input.signal.aborted && uncommitted.length > 0) {
    return transientBatchResult(
      [...published],
      existingOmissions,
      retryPosition(input.records, committed, input.pageOrigin),
      "timeout",
    );
  }
  if (result.reason === "storage_limit") {
    return {
      publishedIds: [...published],
      omissions: [
        ...existingOmissions,
        ...uncommitted.map(({ candidate }) => ({ id: candidate.id, reason: "storage_limit" })),
      ],
      retryCursor: null,
      transientReason: null,
    };
  }
  if (uncommitted.length === 0) {
    return {
      publishedIds: [...published],
      omissions: existingOmissions,
      retryCursor: null,
      transientReason: null,
    };
  }
  if (result.reason !== null) {
    return transientBatchResult(
      [...published],
      existingOmissions,
      retryPosition(input.records, committed, input.pageOrigin),
      transientReason(result.reason, false),
    );
  }
  return transientBatchResult(
    [...published],
    existingOmissions,
    retryPosition(input.records, committed, input.pageOrigin),
    "sidecar_write_failed",
  );
}
