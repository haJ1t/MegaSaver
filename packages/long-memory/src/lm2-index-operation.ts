import { randomUUID } from "node:crypto";
import { type Stats, lstatSync } from "node:fs";
import { dirname } from "node:path";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import {
  type Lm2OperationFence,
  advanceLm2Ledger,
  commitFirstPendingAllocation,
  createPendingAllocations,
  recoverLm2Pending,
} from "./lm2-ledger-recovery.js";
import {
  type BeginLm2IndexOperationInput,
  type Lm2IndexOperationResult,
  type Lm2ReadyIndexOperation,
  acquireWorkspaceIndexLock,
} from "./lm2-lock.js";
import type { Lm2Candidate } from "./lm2-model.js";
import {
  type Lm2PendingAllocation,
  type Lm2QuotaLedger,
  MAX_LM2_PENDING_ALLOCATIONS,
  MAX_LM2_QUOTA_LEDGER_BYTES,
  serializeLm2QuotaLedger,
} from "./lm2-quota-ledger.js";
import { closeDirectoryAnchor, openDirectoryAnchor, sameFileIdentity } from "./lm2-secure-fs.js";
import { publishLm2ReservedBatch, replaceAnchoredFile } from "./lm2-secure-publish.js";
import { parseCandidates } from "./lm2-vector-format.js";
import { ensureIndexLockPath, vectorQuotaLedgerPath } from "./lm2-vector-paths.js";
import {
  type NamedSidecarState,
  existingVectorState,
  inspectNamedSidecar,
  prepareLm2LedgerOperation,
  removePendingTemporary,
} from "./lm2-vector-sidecars.js";

const MAX_METADATA_READS = 1_024;

export async function beginIndexOperation(
  input: BeginLm2IndexOperationInput,
): Promise<Lm2IndexOperationResult> {
  let lockPath: string;
  try {
    if (
      !Number.isFinite(input.deadline.deadlineAtMs) ||
      input.deadline.now() >= input.deadline.deadlineAtMs
    )
      return { status: "invalid", quotaRecovery: "not_needed" };
    lockPath = ensureIndexLockPath(input.storeRoot, input.workspaceKey);
  } catch {
    return { status: "unavailable" };
  }
  const acquired = acquireWorkspaceIndexLock(lockPath);
  if (acquired.status !== "acquired")
    return acquired.status === "busy" ? { status: "busy" } : { status: "unavailable" };
  const lock = acquired.guard;
  const operationId = randomUUID();
  const fence: Lm2OperationFence = {
    operationId,
    lockIdentity: lock.identity,
    lockToken: lock.token,
  };
  const ledgerPath = vectorQuotaLedgerPath(input.storeRoot, input.workspaceKey);
  const ledgerAnchor = openDirectoryAnchor(dirname(ledgerPath), false);
  if (ledgerAnchor === null) {
    lock.release();
    return { status: "unavailable" };
  }
  let ledgerIdentity: Stats | null = null;
  let ledger: Lm2QuotaLedger;
  let metadataReads = 0;
  let finalized = false;

  const assertFence = () => {
    if (finalized) throw new Error("stale operation");
    lock.assertIntact();
    if (ledgerIdentity !== null) {
      const currentLedgerIdentity = lstatSync(ledgerPath);
      if (
        currentLedgerIdentity === undefined ||
        !sameFileIdentity(currentLedgerIdentity, ledgerIdentity)
      ) {
        throw new Error("ledger identity changed");
      }
    }
  };
  const assertGuard = () => {
    assertFence();
    if (input.deadline.signal.aborted || input.deadline.now() >= input.deadline.deadlineAtMs) {
      throw new Error("stale operation");
    }
  };
  const persist = (next: Lm2QuotaLedger) => {
    const serialized = serializeLm2QuotaLedger(next);
    if (Buffer.byteLength(serialized, "utf8") > MAX_LM2_QUOTA_LEDGER_BYTES)
      throw new Error("oversize ledger");
    replaceAnchoredFile(ledgerAnchor, "vector-quota-ledger-v1.json", serialized, assertFence);
    ledgerIdentity = lstatSync(ledgerPath);
    ledger = next;
  };
  const inspect = (
    entry: Pick<Lm2PendingAllocation, "modelFingerprint" | "finalName">,
  ): NamedSidecarState => {
    if (metadataReads >= MAX_METADATA_READS) return { status: "invalid" };
    metadataReads += 1;
    return inspectNamedSidecar({
      storeRoot: input.storeRoot,
      workspaceKey: input.workspaceKey,
      fingerprint: entry.modelFingerprint,
      name: entry.finalName,
    });
  };
  const recoverPending = (target: Lm2QuotaLedger) =>
    recoverLm2Pending({
      ledger: target,
      probe: (entry) => {
        const state = inspect(entry);
        return state.status === "valid"
          ? {
              status: "valid",
              digest: state.digest,
              serializedBytes: state.metadata.serializedBytes,
            }
          : state;
      },
      removeTemporary: (entry) =>
        removePendingTemporary({
          storeRoot: input.storeRoot,
          workspaceKey: input.workspaceKey,
          entry,
        }),
    });
  const settlePending = () => {
    const recovered = recoverPending(ledger);
    if (recovered.status === "blocked_pending") return false;
    if (recovered.status === "recovered_pending")
      persist(advanceLm2Ledger({ ledger: recovered.ledger, fence }));
    return true;
  };

  const prepared = prepareLm2LedgerOperation({
    storeRoot: input.storeRoot,
    workspaceKey: input.workspaceKey,
    ledgerAnchor,
    fence,
    lockIdentity: lock.identity,
    lockToken: lock.token,
    adoptExistingLedger: (stat) => {
      ledgerIdentity = stat;
    },
    persist,
    recover: recoverPending,
  });
  if (prepared.status !== "ready") {
    closeDirectoryAnchor(ledgerAnchor);
    lock.release();
    return {
      status: "invalid",
      quotaRecovery: prepared.status === "blocked" ? "blocked_pending" : "not_needed",
    };
  }
  ledger = prepared.ledger;

  const publishBatch: Lm2ReadyIndexOperation["publishBatch"] = async (request) => {
    const published: string[] = [];
    let records: Lm2Candidate[];
    try {
      assertGuard();
      records = parseCandidates(input.workspaceKey, request.records, MAX_LM2_PENDING_ALLOCATIONS);
    } catch {
      return { published, reason: "lock_integrity_lost" };
    }
    const fingerprint = modelDescriptorFingerprint(input.model);
    const planned: Lm2Candidate[] = [];
    try {
      for (const record of records) {
        if (metadataReads >= MAX_METADATA_READS) return { published, reason: "write_failed" };
        metadataReads += 1;
        const state = existingVectorState({
          storeRoot: input.storeRoot,
          workspaceKey: input.workspaceKey,
          model: input.model,
          fingerprint,
          candidate: record,
          ledger,
        });
        if (state === "invalid") return { published, reason: "write_failed" };
        if (state === "missing") planned.push(record);
      }
      if (planned.length === 0) return { published, reason: null };
      const first = ledger.nextAllocationSequence;
      const entries = createPendingAllocations({
        records: planned,
        modelFingerprint: fingerprint,
        firstAllocationSequence: first,
        operationId,
      });
      const pending = {
        operationId,
        expectedGeneration: ledger.generation,
        firstAllocationSequence: first,
        lastAllocationSequence: first + entries.length - 1,
        entries,
      };
      let reservedLedger: Lm2QuotaLedger;
      try {
        reservedLedger = advanceLm2Ledger({ ledger: { ...ledger, pending }, fence, pending });
      } catch {
        return { published, reason: "storage_limit" };
      }
      persist(reservedLedger);
      return await publishLm2ReservedBatch({
        storeRoot: input.storeRoot,
        workspaceKey: input.workspaceKey,
        model: input.model,
        fingerprint,
        records: planned,
        entries,
        ledgerEpoch: ledger.epoch,
        signal: input.deadline.signal,
        deadlineAtMs: input.deadline.deadlineAtMs,
        now: input.deadline.now,
        embed: request.embed,
        assertEgressAllowed: request.assertEgressAllowed,
        recheckEvidence: request.recheckEvidence,
        assertGuard,
        settlePending: () => {
          settlePending();
        },
        persistMaterialized: (materialized) => {
          const materializedPending = { ...pending, entries: materialized };
          persist(
            advanceLm2Ledger({
              ledger: { ...ledger, pending: materializedPending },
              fence,
              pending: materializedPending,
            }),
          );
        },
        currentEntry: () => ledger.pending?.entries[0],
        inspectPublished: (entry) => {
          const state = inspect(entry);
          return state.status === "valid"
            ? {
                status: "valid",
                digest: state.digest,
                serializedBytes: state.metadata.serializedBytes,
              }
            : state;
        },
        commitFirst: () => persist(commitFirstPendingAllocation({ ledger, fence })),
      });
    } catch (error) {
      try {
        settlePending();
      } catch {
        /* Retain the pending transaction for the next locked recovery. */
      }
      return {
        published,
        reason:
          error instanceof Lm2Error && error.code === "invalid_vectors"
            ? "invalid_vectors"
            : "write_failed",
      };
    }
  };

  return {
    status: "ready",
    quotaRecovery: prepared.quotaRecovery,
    publishBatch,
    async finalize() {
      if (finalized) return;
      try {
        if (ledger.pending !== null) settlePending();
        if (ledger.pending === null) persist(advanceLm2Ledger({ ledger, fence: null }));
      } finally {
        finalized = true;
        closeDirectoryAnchor(ledgerAnchor);
        lock.release();
      }
    },
  };
}
