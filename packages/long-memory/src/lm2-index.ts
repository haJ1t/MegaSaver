import { performance } from "node:perf_hooks";
import type { EvidenceEligibilityPort } from "./lm1-model.js";
import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CandidateCatalog, Lm2CatalogPage } from "./lm2-catalog.js";
import { Lm2Error } from "./lm2-errors.js";
import {
  createLm2IndexAdmission,
  cursorAfterCatalogEntry,
  cursorBeforeCatalogEntry,
  parseLm2IndexFactory,
} from "./lm2-index-admission.js";
import {
  type Lm2PendingIndexRecord,
  expiredIndexReceipt,
  publishLm2IndexBatch,
  retryIndexReceipt,
  terminalIndexReceipt,
} from "./lm2-index-batches.js";
import type { Lm2ReadyIndexOperation } from "./lm2-lock.js";
import {
  type EmbeddingPort,
  type Lm2IndexReceipt,
  type Lm2IndexRequest,
  type ModelDescriptor,
  type RemoteEmbeddingApprovalPort,
  lm2IndexRequestSchema,
} from "./lm2-model.js";
import { canonicalEmbeddingInput } from "./lm2-vector-format.js";
import type { Lm2VectorStore } from "./lm2-vector-store.js";

const MAX_CATALOG_ENTRIES_PER_CALL = 1_024;
const MAX_DOCUMENTS_PER_BATCH = 16;
const MAX_BATCH_INPUT_CODE_UNITS = 65_536;

export type Lm2IndexService = {
  index(request: Lm2IndexRequest): Promise<Lm2IndexReceipt>;
};

type IndexServiceInput = {
  catalog: Lm2CandidateCatalog;
  store: FileLm1Store;
  vectors: Pick<Lm2VectorStore, "beginIndexOperation">;
  evidenceEligibility: EvidenceEligibilityPort;
  embedding: EmbeddingPort;
  model: ModelDescriptor;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  defaultTimeoutMs: number;
};

type QuotaRecovery = Lm2IndexReceipt["quotaRecovery"];

async function processPage(input: {
  page: Lm2CatalogPage;
  origin: string | null;
  request: Lm2IndexRequest;
  operation: Lm2ReadyIndexOperation;
  quotaRecovery: QuotaRecovery;
  service: IndexServiceInput;
  signal: AbortSignal;
  expired: Promise<void>;
}): Promise<Lm2IndexReceipt> {
  if (input.page.entries.length > MAX_CATALOG_ENTRIES_PER_CALL) {
    throw new Lm2Error("store_corrupt", "LM2 catalog page exceeds the index budget.");
  }
  const admission = createLm2IndexAdmission({
    workspaceKey: input.request.workspaceKey,
    store: input.service.store,
    evidenceEligibility: input.service.evidenceEligibility,
    signal: input.signal,
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
      expired: input.expired,
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
        quotaRecovery: input.quotaRecovery,
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

export function createLm2IndexService(input: IndexServiceInput): Lm2IndexService {
  const { model, fingerprint } = parseLm2IndexFactory(input);
  const service = { ...input, model };
  return {
    async index(request) {
      const parsed = lm2IndexRequestSchema.safeParse(request);
      if (!parsed.success || parsed.data.modelFingerprint !== fingerprint) {
        throw new Lm2Error("invalid_input", "Invalid LM2 index request.");
      }
      const origin = parsed.data.cursor ?? null;
      const controller = new AbortController();
      let expire: () => void = () => {};
      const expired = new Promise<void>((resolve) => {
        expire = resolve;
      });
      const timeout = parsed.data.timeoutMs ?? input.defaultTimeoutMs;
      const deadlineAtMs = performance.now() + timeout;
      const timer = setTimeout(() => {
        controller.abort();
        expire();
      }, timeout);
      const beginWork = service.vectors.beginIndexOperation({
        workspaceKey: parsed.data.workspaceKey,
        model,
        deadline: { signal: controller.signal, deadlineAtMs, now: () => performance.now() },
      });
      const begin = await Promise.race([
        beginWork.then((operation) => ({ type: "operation" as const, operation })),
        expired.then(() => ({ type: "timeout" as const })),
      ]);
      if (begin.type === "timeout") {
        beginWork
          .then((operation) => (operation.status === "ready" ? operation.finalize() : undefined))
          .catch(() => undefined);
        clearTimeout(timer);
        return retryIndexReceipt({
          retryCursor: origin,
          reason: "timeout",
          quotaRecovery: "not_needed",
        });
      }
      const operation = begin.operation;
      if (operation.status !== "ready") {
        clearTimeout(timer);
        controller.abort();
        const reason =
          operation.status === "busy"
            ? "index_busy"
            : operation.status === "unavailable"
              ? "index_lock_unavailable"
              : "quota_state_invalid";
        return retryIndexReceipt({
          retryCursor: origin,
          reason,
          quotaRecovery: operation.status === "invalid" ? operation.quotaRecovery : "not_needed",
        });
      }

      let receipt: Lm2IndexReceipt | undefined;
      let failure: unknown;
      try {
        const page = service.catalog.page({
          workspaceKey: parsed.data.workspaceKey,
          cursor: origin,
          limit: MAX_CATALOG_ENTRIES_PER_CALL,
        });
        receipt = await processPage({
          page,
          origin,
          request: parsed.data,
          operation,
          quotaRecovery: operation.quotaRecovery,
          service,
          signal: controller.signal,
          expired,
        });
      } catch (error) {
        if (error instanceof Lm2Error && error.code === "cursor_expired") {
          receipt = expiredIndexReceipt(operation.quotaRecovery);
        } else {
          failure = error;
        }
      }
      clearTimeout(timer);
      controller.abort();
      let finalizeFailed = false;
      try {
        await operation.finalize();
      } catch {
        finalizeFailed = true;
      }
      if (failure !== undefined) throw failure;
      if (receipt === undefined)
        throw new Lm2Error("write_failed", "LM2 index receipt is missing.");
      if (!finalizeFailed) return receipt;
      const retryCursor =
        receipt.outcome === "continue"
          ? receipt.nextCursor
          : receipt.outcome === "retry"
            ? receipt.retryCursor
            : origin;
      return retryIndexReceipt({
        indexedCount: receipt.indexedCount,
        omitted: receipt.omitted,
        retryCursor,
        reason: "lock_integrity_lost",
        quotaRecovery: receipt.quotaRecovery,
      });
    },
  };
}
