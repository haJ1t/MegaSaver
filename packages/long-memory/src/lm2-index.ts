import { performance } from "node:perf_hooks";
import type { EvidenceEligibilityPort } from "./lm1-model.js";
import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CandidateCatalog } from "./lm2-catalog.js";
import { combineLm2CleanupFailures } from "./lm2-cleanup-errors.js";
import { Lm2Error } from "./lm2-errors.js";
import { parseLm2IndexFactory } from "./lm2-index-admission.js";
import { MAX_CATALOG_ENTRIES_PER_CALL, processLm2IndexPage } from "./lm2-index-page.js";
import {
  expiredIndexReceipt,
  retryIndexReceipt,
  withLm2IndexReceiptCause,
} from "./lm2-index-receipts.js";
import {
  type EmbeddingPort,
  type Lm2IndexReceipt,
  type Lm2IndexRequest,
  type ModelDescriptor,
  type RemoteEmbeddingApprovalPort,
  lm2IndexRequestSchema,
} from "./lm2-model.js";
import type { Lm2VectorStore } from "./lm2-vector-store.js";

export type Lm2IndexService = { index(request: Lm2IndexRequest): Promise<Lm2IndexReceipt> };

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
      const deadlineReached = () => controller.signal.aborted || performance.now() >= deadlineAtMs;
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
        receipt = deadlineReached()
          ? retryIndexReceipt({
              retryCursor: origin,
              reason: "timeout",
              quotaRecovery: operation.quotaRecovery,
            })
          : await processLm2IndexPage({
              page,
              origin,
              request: parsed.data,
              operation,
              quotaRecovery: operation.quotaRecovery,
              service,
              signal: controller.signal,
              deadlineReached,
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
      let finalizeFailure: unknown;
      try {
        await operation.finalize();
      } catch (error) {
        finalizeFailure = error;
      }
      if (finalizeFailure !== undefined) {
        const retryCursor =
          receipt?.outcome === "continue"
            ? receipt.nextCursor
            : receipt?.outcome === "retry"
              ? receipt.retryCursor
              : origin;
        return withLm2IndexReceiptCause(
          retryIndexReceipt({
            indexedCount: receipt?.indexedCount ?? 0,
            omitted: receipt?.omitted ?? [],
            retryCursor,
            reason: "quota_state_invalid",
            quotaRecovery: "blocked_pending",
          }),
          combineLm2CleanupFailures(failure, finalizeFailure),
        );
      }
      if (failure !== undefined) throw failure;
      if (receipt === undefined)
        throw new Lm2Error("write_failed", "LM2 index receipt is missing.");
      return receipt;
    },
  };
}
