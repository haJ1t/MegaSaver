import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import { createLm2IndexPlanSequence } from "./lm2-index-plan.js";
import {
  type Lm2OperationFence,
  advanceLm2Ledger,
  commitFirstPendingAllocation,
  createPendingAllocations,
} from "./lm2-ledger-recovery.js";
import {
  type BeginLm2IndexOperationInput,
  Lm2ApprovalTimeoutError,
  type Lm2PublishBatchResult,
  type Lm2ReadyIndexOperation,
} from "./lm2-lock.js";
import type { Lm2Candidate } from "./lm2-model.js";
import {
  type Lm2PendingAllocation,
  type Lm2QuotaLedger,
  MAX_LM2_PENDING_ALLOCATIONS,
} from "./lm2-quota-ledger.js";
import {
  Lm2CleanupError,
  Lm2PartialPublicationError,
  isLm2CleanupError,
  publishLm2ReservedBatch,
} from "./lm2-secure-publish.js";
import { canonicalEmbeddingInput, parseCandidates } from "./lm2-vector-format.js";
import { type NamedSidecarState, existingVectorState } from "./lm2-vector-sidecars.js";

export type Lm2OperationPublisher = {
  publishBatch: Lm2ReadyIndexOperation["publishBatch"];
  isInFlight(): boolean;
};

export function createLm2OperationPublisher(input: {
  operation: BeginLm2IndexOperationInput;
  operationId: string;
  fence: Lm2OperationFence;
  ledger(): Lm2QuotaLedger;
  persist(next: Lm2QuotaLedger): void;
  inspect(entry: Lm2PendingAllocation): NamedSidecarState;
  takeMetadataRead(): boolean;
  settlePending(): boolean;
  assertGuard(): void;
  isFinalized(): boolean;
  cleanupBlocked(): boolean;
  blockCleanup(): void;
}): Lm2OperationPublisher {
  const fingerprint = modelDescriptorFingerprint(input.operation.model);
  const planSequence = createLm2IndexPlanSequence({
    operationId: input.operationId,
    workspaceKey: input.operation.workspaceKey,
    modelFingerprint: fingerprint,
    deadlineAtMs: input.operation.deadline.deadlineAtMs,
  });
  let publishInFlight = false;

  const performPublishBatch = async (
    request: Parameters<Lm2ReadyIndexOperation["publishBatch"]>[0],
  ): Promise<Lm2PublishBatchResult> => {
    const published: string[] = [];
    const existing: string[] = [];
    let records: Lm2Candidate[];
    try {
      input.assertGuard();
      records = parseCandidates(
        input.operation.workspaceKey,
        request.records,
        MAX_LM2_PENDING_ALLOCATIONS,
      );
    } catch {
      return { published, existing, reason: "lock_integrity_lost" };
    }
    const planned: Lm2Candidate[] = [];
    try {
      for (const record of records) {
        if (!input.takeMetadataRead()) return { published, existing, reason: "write_failed" };
        const state = existingVectorState({
          storeRoot: input.operation.storeRoot,
          workspaceKey: input.operation.workspaceKey,
          model: input.operation.model,
          fingerprint,
          candidate: record,
          ledger: input.ledger(),
        });
        if (state === "invalid") return { published, existing, reason: "write_failed" };
        if (state === "missing") planned.push(record);
        else existing.push(record.id);
      }
      if (planned.length === 0) return { published, existing, reason: null };
      const ledger = input.ledger();
      const first = ledger.nextAllocationSequence;
      const entries = createPendingAllocations({
        records: planned,
        modelFingerprint: fingerprint,
        firstAllocationSequence: first,
        operationId: input.operationId,
      });
      const pending = {
        operationId: input.operationId,
        expectedGeneration: ledger.generation,
        firstAllocationSequence: first,
        lastAllocationSequence: first + entries.length - 1,
        entries,
      };
      let reservedLedger: Lm2QuotaLedger;
      try {
        reservedLedger = advanceLm2Ledger({
          ledger: { ...ledger, pending },
          fence: input.fence,
          pending,
        });
      } catch {
        return { published, existing, reason: "storage_limit" };
      }
      input.persist(reservedLedger);
      const planGeneration = input.ledger().generation;
      const missingIds = planned.map(({ id }) => id);
      const plan = planSequence.mint({
        generation: planGeneration,
        candidates: records,
        existingIds: existing,
        missingIds,
      });
      const result = await publishLm2ReservedBatch({
        storeRoot: input.operation.storeRoot,
        workspaceKey: input.operation.workspaceKey,
        model: input.operation.model,
        fingerprint,
        records: planned,
        entries,
        ledgerEpoch: input.ledger().epoch,
        signal: input.operation.deadline.signal,
        deadlineAtMs: input.operation.deadline.deadlineAtMs,
        now: input.operation.deadline.now,
        embed: async (call) => {
          let now: number;
          try {
            now = input.operation.deadline.now();
          } catch {
            throw new Error("LM2 batch plan clock failed.");
          }
          const consumed = await planSequence.consume(plan, {
            generation: planGeneration,
            candidates: records,
            existingIds: existing,
            missingIds,
            now,
            egress: async (frozenMissing) => {
              const texts = frozenMissing.map(canonicalEmbeddingInput);
              if (
                call.texts.length !== texts.length ||
                call.texts.some((text, index) => text !== texts[index])
              ) {
                throw new Error("LM2 batch plan projection changed.");
              }
              return request.embed({ ...call, texts });
            },
          });
          if (consumed.status !== "consumed") throw new Error("LM2 batch plan was rejected.");
          return consumed.value;
        },
        assertEgressAllowed: request.assertEgressAllowed,
        recheckEvidence: request.recheckEvidence,
        assertGuard: input.assertGuard,
        settlePending: () => {
          input.settlePending();
        },
        persistMaterialized: (materialized) => {
          const materializedPending = { ...pending, entries: materialized };
          input.persist(
            advanceLm2Ledger({
              ledger: { ...input.ledger(), pending: materializedPending },
              fence: input.fence,
              pending: materializedPending,
            }),
          );
        },
        currentEntry: () => input.ledger().pending?.entries[0],
        inspectPublished: (entry) => {
          const state = input.inspect(entry);
          return state.status === "valid"
            ? {
                status: "valid",
                digest: state.digest,
                serializedBytes: state.metadata.serializedBytes,
              }
            : state;
        },
        commitFirst: () =>
          input.persist(
            commitFirstPendingAllocation({ ledger: input.ledger(), fence: input.fence }),
          ),
      });
      return { ...result, existing };
    } catch (error) {
      if (isLm2CleanupError(error)) {
        input.blockCleanup();
      } else {
        try {
          if (!input.settlePending()) input.blockCleanup();
        } catch {
          input.blockCleanup();
        }
      }
      const ledger = input.ledger();
      const committed =
        error instanceof Lm2PartialPublicationError || error instanceof Lm2CleanupError
          ? error.entries
              .filter((entry) => entry.allocationSequence <= ledger.committedThroughAllocation)
              .map((entry) => entry.recordId)
          : published;
      if (input.cleanupBlocked()) {
        return {
          published: committed,
          existing,
          reason: "quota_state_invalid",
          quotaRecovery: "blocked_pending",
        };
      }
      return {
        published: committed,
        existing,
        reason:
          error instanceof Lm2ApprovalTimeoutError
            ? "timeout"
            : error instanceof Lm2Error && error.code === "invalid_vectors"
              ? "invalid_vectors"
              : "write_failed",
      };
    }
  };

  return {
    publishBatch: async (request) => {
      if (input.cleanupBlocked()) {
        return {
          published: [],
          existing: [],
          reason: "quota_state_invalid",
          quotaRecovery: "blocked_pending",
        };
      }
      if (publishInFlight || input.isFinalized()) {
        return { published: [], existing: [], reason: "lock_integrity_lost" };
      }
      publishInFlight = true;
      try {
        return await performPublishBatch(request);
      } finally {
        publishInFlight = false;
      }
    },
    isInFlight: () => publishInFlight,
  };
}
