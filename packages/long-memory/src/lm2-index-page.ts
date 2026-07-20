import type { EvidenceEligibilityPort } from "./lm1-model.js";
import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CatalogPage } from "./lm2-catalog.js";
import { Lm2Error } from "./lm2-errors.js";
import {
  createLm2IndexAdmission,
  cursorAfterCatalogEntry,
  cursorBeforeCatalogEntry,
} from "./lm2-index-admission.js";
import { type Lm2PendingIndexRecord, publishLm2IndexBatch } from "./lm2-index-batches.js";
import { retryIndexReceipt, terminalIndexReceipt } from "./lm2-index-receipts.js";
import type { Lm2ReadyIndexOperation } from "./lm2-lock.js";
import type {
  EmbeddingPort,
  Lm2IndexReceipt,
  Lm2IndexRequest,
  ModelDescriptor,
  RemoteEmbeddingApprovalPort,
} from "./lm2-model.js";
import { canonicalEmbeddingInput } from "./lm2-vector-format.js";

export const MAX_CATALOG_ENTRIES_PER_CALL = 1_024;
const MAX_DOCUMENTS_PER_BATCH = 16;
const MAX_BATCH_INPUT_CODE_UNITS = 65_536;

export type Lm2IndexPageService = {
  store: FileLm1Store;
  evidenceEligibility: EvidenceEligibilityPort;
  embedding: EmbeddingPort;
  model: ModelDescriptor;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
};

type QuotaRecovery = Lm2IndexReceipt["quotaRecovery"];

export async function processLm2IndexPage(input: {
  page: Lm2CatalogPage;
  origin: string | null;
  request: Lm2IndexRequest;
  operation: Lm2ReadyIndexOperation;
  quotaRecovery: QuotaRecovery;
  service: Lm2IndexPageService;
  signal: AbortSignal;
  deadlineReached(): boolean;
  expired: Promise<void>;
}): Promise<Lm2IndexReceipt> {
  if (input.page.entries.length > MAX_CATALOG_ENTRIES_PER_CALL) {
    throw new Lm2Error("store_corrupt", "LM2 catalog page exceeds the index budget.");
  }
  const admission = createLm2IndexAdmission({
    workspaceKey: input.request.workspaceKey,
    store: input.service.store,
    evidenceEligibility: input.service.evidenceEligibility,
    deadlineReached: input.deadlineReached,
    expired: input.expired,
  });
  const omitted: { id: string; reason: string }[] = [];
  let indexedCount = 0;
  let admittedCount = 0;
  let pending: Lm2PendingIndexRecord[] = [];
  let pendingCodeUnits = 0;

  const flush = async (): Promise<Lm2IndexReceipt | null> => {
    if (pending.length === 0) return null;
    const batch = pending;
    const result = await publishLm2IndexBatch({
      operation: input.operation,
      records: batch,
      model: input.service.model,
      embedding: input.service.embedding,
      workspaceKey: input.request.workspaceKey,
      signal: input.signal,
      pageOrigin: input.origin,
      ...(input.service.remoteApproval === undefined
        ? {}
        : { remoteApproval: input.service.remoteApproval }),
      ...(input.service.approvalRef === undefined
        ? {}
        : { approvalRef: input.service.approvalRef }),
      recheckEvidence: admission.recheck,
    });
    indexedCount += result.publishedIds.length;
    omitted.push(...result.omissions);
    if (result.transientReason !== null) {
      return retryIndexReceipt({
        indexedCount,
        omitted,
        retryCursor: result.retryCursor,
        reason: result.transientReason,
        quotaRecovery:
          result.transientReason === "quota_state_invalid"
            ? "blocked_pending"
            : input.quotaRecovery,
      });
    }
    pending = [];
    pendingCodeUnits = 0;
    return null;
  };

  for (const [index, entry] of input.page.entries.entries()) {
    const cursorBefore = cursorBeforeCatalogEntry({
      workspaceKey: input.request.workspaceKey,
      origin: input.origin,
      page: input.page,
      index,
    });
    const cursorAfter = cursorAfterCatalogEntry({
      workspaceKey: input.request.workspaceKey,
      page: input.page,
      index,
    });
    if (admittedCount >= input.request.maxRecords) {
      const failed = await flush();
      return (
        failed ??
        terminalIndexReceipt({
          indexedCount,
          omitted,
          nextCursor: cursorBefore,
          quotaRecovery: input.quotaRecovery,
        })
      );
    }
    const result = await admission.admit(entry);
    if (result.type !== "eligible") {
      const failed = await flush();
      if (failed !== null) return failed;
      if (result.type === "retry") {
        return retryIndexReceipt({
          indexedCount,
          omitted,
          retryCursor: cursorBefore,
          reason: result.reason,
          quotaRecovery: input.quotaRecovery,
        });
      }
      if (result.type === "capacity") {
        return terminalIndexReceipt({
          indexedCount,
          omitted,
          nextCursor: cursorBefore ?? input.page.nextCursor,
          quotaRecovery: input.quotaRecovery,
        });
      }
      omitted.push({ id: entry.id, reason: result.reason });
      continue;
    }
    const codeUnits = canonicalEmbeddingInput(result.record.candidate).length;
    if (
      pending.length >= MAX_DOCUMENTS_PER_BATCH ||
      pendingCodeUnits + codeUnits > MAX_BATCH_INPUT_CODE_UNITS
    ) {
      const failed = await flush();
      if (failed !== null) return failed;
    }
    pending.push({ ...result.record, cursorBefore, cursorAfter });
    pendingCodeUnits += codeUnits;
    admittedCount += 1;
  }
  const failed = await flush();
  if (failed !== null) return failed;
  return terminalIndexReceipt({
    indexedCount,
    omitted,
    nextCursor: input.page.nextCursor,
    quotaRecovery: input.quotaRecovery,
  });
}
