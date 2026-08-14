import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { combineLm2CleanupFailures } from "./lm2-cleanup-errors.js";
import { Lm2Error } from "./lm2-errors.js";
import { createLm2OperationPublisher } from "./lm2-index-operation-publish.js";
import {
  type Lm2LedgerGuard,
  createLm2LedgerGuard,
  revalidateLm2LedgerGuard,
} from "./lm2-ledger-guard.js";
import {
  type Lm2OperationFence,
  advanceLm2Ledger,
  recoverLm2Pending,
} from "./lm2-ledger-recovery.js";
import {
  type BeginLm2IndexOperationInput,
  type Lm2IndexOperationResult,
  acquireWorkspaceIndexLock,
} from "./lm2-lock.js";
import {
  type Lm2PendingAllocation,
  type Lm2QuotaLedger,
  MAX_LM2_QUOTA_LEDGER_BYTES,
  serializeLm2QuotaLedger,
} from "./lm2-quota-ledger.js";
import { closeDirectoryAnchor, openDirectoryAnchor } from "./lm2-secure-fs.js";
import { Lm2CleanupError, replaceAnchoredFile } from "./lm2-secure-publish.js";
import { ensureIndexLockPath, vectorQuotaLedgerPath } from "./lm2-vector-paths.js";
import {
  type NamedSidecarState,
  inspectNamedSidecar,
  prepareLm2LedgerOperation,
  removePendingTemporary,
} from "./lm2-vector-sidecars.js";

const MAX_METADATA_READS = 1_024;
const LEDGER_NAME = "vector-quota-ledger-v1.json";
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
    try {
      lock.release();
    } catch {
      return { status: "invalid", quotaRecovery: "blocked_pending" };
    }
    return { status: "unavailable" };
  }
  let ledgerGuard: Lm2LedgerGuard | null = null;
  let ledger: Lm2QuotaLedger;
  let metadataReads = 0;
  let finalized = false;
  let cleanupBlocked = false;
  let ledgerIntegrityLost = false;
  let ledgerIntegrityFailure: unknown;
  let cleanupFailure: unknown;
  const loseLedgerIntegrity = (failure: unknown) => {
    if (!ledgerIntegrityLost) ledgerIntegrityFailure = failure;
    ledgerIntegrityLost = true;
  };
  const assertFence = () => {
    if (finalized) throw new Error("stale operation");
    if (ledgerIntegrityLost) {
      throw new Lm2Error("index_lock_unavailable", "LM2 ledger integrity was lost.");
    }
    try {
      lock.assertIntact();
      if (ledgerGuard !== null) {
        revalidateLm2LedgerGuard({
          anchor: ledgerAnchor,
          name: LEDGER_NAME,
          workspaceKey: input.workspaceKey,
          guard: ledgerGuard,
        });
      }
    } catch (error) {
      loseLedgerIntegrity(error);
      throw error;
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
    const expectedContentDigest = createHash("sha256").update(serialized).digest("hex");
    try {
      const replacement = replaceAnchoredFile(
        ledgerAnchor,
        LEDGER_NAME,
        serialized,
        expectedContentDigest,
        MAX_LM2_QUOTA_LEDGER_BYTES,
        assertFence,
      );
      ledgerGuard = createLm2LedgerGuard({
        read: replacement,
        workspaceKey: input.workspaceKey,
        expected: next,
      });
      ledger = ledgerGuard.ledger;
    } catch (error) {
      if (error instanceof Lm2Error && error.code === "index_lock_unavailable") {
        loseLedgerIntegrity(error);
      }
      throw error;
    }
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
    adoptExistingLedger: (existing, raw, stat) => {
      const contentDigest = createHash("sha256").update(raw).digest("hex");
      ledgerGuard = createLm2LedgerGuard({
        read: { raw, stat, contentDigest },
        workspaceKey: input.workspaceKey,
        expected: existing,
      });
    },
    persist,
    recover: recoverPending,
  });
  if (prepared.status !== "ready") {
    // #region debug log
    if (process.platform === "win32") {
      fetch("https://debug-agent-remote.aidenbai.workers.dev/s/H5tarNgjtoGj02225eBFV", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "H5tarNgjtoGj02225eBFV",
          hypothesisId: "H3",
          location: "lm2-index-operation.ts:beginIndexOperation:prepared-not-ready",
          message: "prepared",
          data: { preparedStatus: prepared.status, root: input.storeRoot },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
    let cleanupFailed = false;
    try {
      closeDirectoryAnchor(ledgerAnchor);
    } catch {
      cleanupFailed = true;
    }
    try {
      lock.release();
    } catch {
      cleanupFailed = true;
    }
    return {
      status: "invalid",
      quotaRecovery:
        cleanupFailed || prepared.status === "blocked" ? "blocked_pending" : "not_needed",
    };
  }
  ledger = prepared.ledger;
  const publisher = createLm2OperationPublisher({
    operation: input,
    operationId,
    fence,
    ledger: () => ledger,
    persist,
    inspect,
    takeMetadataRead: () => {
      if (metadataReads >= MAX_METADATA_READS) return false;
      metadataReads += 1;
      return true;
    },
    settlePending,
    assertGuard,
    isFinalized: () => finalized,
    cleanupBlocked: () => cleanupBlocked,
    blockCleanup: (failure) => {
      cleanupBlocked = true;
      cleanupFailure = combineLm2CleanupFailures(cleanupFailure, failure);
    },
  });
  return {
    status: "ready",
    quotaRecovery: prepared.quotaRecovery,
    publishBatch: publisher.publishBatch,
    async finalize() {
      if (finalized) return;
      if (publisher.isInFlight()) {
        throw new Lm2CleanupError("LM2 publication is still in flight.", undefined);
      }
      let failure: unknown;
      try {
        if (cleanupBlocked) {
          throw new Lm2CleanupError("LM2 cleanup remains blocked.", cleanupFailure);
        }
        if (ledgerIntegrityLost) {
          throw new Lm2Error("index_lock_unavailable", "LM2 ledger integrity was lost.", {
            cause: ledgerIntegrityFailure,
          });
        }
        if (ledger.pending !== null && !settlePending()) {
          cleanupBlocked = true;
          cleanupFailure = new Lm2CleanupError(
            "LM2 pending cleanup remains blocked.",
            cleanupFailure,
          );
          throw cleanupFailure;
        }
        if (ledger.pending === null) persist(advanceLm2Ledger({ ledger, fence: null }));
      } catch (error) {
        failure = error;
      }
      finalized = true;
      try {
        closeDirectoryAnchor(ledgerAnchor);
      } catch (error) {
        failure = combineLm2CleanupFailures(failure, error);
      }
      try {
        lock.release();
      } catch (error) {
        failure = combineLm2CleanupFailures(failure, error);
      }
      if (failure !== undefined)
        throw new Lm2CleanupError("LM2 operation cleanup failed.", failure);
    },
  };
}
