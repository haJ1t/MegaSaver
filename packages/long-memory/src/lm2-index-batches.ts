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
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).sort().join("\0") !== "modelFingerprint\0vectors"
  ) {
    throw new Error("invalid embedding result");
  }
  const returnedFingerprint: unknown = Reflect.get(value, "modelFingerprint");
  const returnedVectors: unknown = Reflect.get(value, "vectors");
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
  published: ReadonlySet<string>,
  pageOrigin: string | null,
): string | null {
  let lastPublishedIndex = -1;
  records.forEach((record, index) => {
    if (published.has(record.candidate.id)) lastPublishedIndex = index;
  });
  return (
    records.slice(lastPublishedIndex + 1).find((record) => !published.has(record.candidate.id))
      ?.cursorBefore ?? pageOrigin
  );
}

function transientBatchResult(
  publishedIds: readonly string[],
  retryCursor: string | null,
  transientReason: BatchTransientReason,
): Lm2IndexBatchResult {
  return { publishedIds, omissions: [], retryCursor, transientReason };
}

export async function publishLm2IndexBatch(input: {
  operation: Lm2ReadyIndexOperation;
  records: readonly Lm2PendingIndexRecord[];
  model: ModelDescriptor;
  embedding: EmbeddingPort;
  workspaceKey: string;
  signal: AbortSignal;
  expired: Promise<void>;
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
  const settled = work
    .then((result) => ({ type: "result" as const, result }))
    .catch(() => ({ type: "error" as const }));
  const outcome = await Promise.race([
    settled,
    input.expired.then(() => ({ type: "timeout" as const })),
  ]);
  if (outcome.type === "timeout") {
    work.catch(() => undefined);
    return transientBatchResult([], input.records[0]?.cursorBefore ?? input.pageOrigin, "timeout");
  }
  if (outcome.type === "error") {
    return transientBatchResult(
      [],
      input.records[0]?.cursorBefore ?? input.pageOrigin,
      input.signal.aborted ? "timeout" : "sidecar_write_failed",
    );
  }
  const published = new Set(outcome.result.published);
  if (
    published.size !== outcome.result.published.length ||
    outcome.result.published.some((id) => !expectedIds.has(id))
  ) {
    return transientBatchResult(
      [],
      input.records[0]?.cursorBefore ?? input.pageOrigin,
      "sidecar_write_failed",
    );
  }
  const unpublished = input.records.filter(({ candidate }) => !published.has(candidate.id));
  if (outcome.result.reason === "storage_limit") {
    return {
      publishedIds: [...published],
      omissions: unpublished.map(({ candidate }) => ({
        id: candidate.id,
        reason: "storage_limit",
      })),
      retryCursor: null,
      transientReason: null,
    };
  }
  if (outcome.result.reason !== null) {
    let retryCursor = retryPosition(input.records, published, input.pageOrigin);
    if (outcome.result.reason === "remote_approval_denied") {
      for (const record of input.records) {
        try {
          const probe = await input.operation.publishBatch({
            records: [record.candidate],
            assertEgressAllowed: async () => false,
            recheckEvidence: input.recheckEvidence,
            embed: async () => {
              throw new Error("denied probe cannot egress");
            },
          });
          if (probe.reason === null) continue;
        } catch {}
        retryCursor = record.cursorBefore;
        break;
      }
    }
    return transientBatchResult(
      [...published],
      retryCursor,
      transientReason(outcome.result.reason, input.signal.aborted),
    );
  }
  return {
    publishedIds: [...published],
    omissions: unpublished.map(({ candidate }) => ({
      id: candidate.id,
      reason: "already_indexed",
    })),
    retryCursor: null,
    transientReason: null,
  };
}
