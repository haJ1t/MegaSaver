import { embeddingInputDigest } from "./lm2-identity.js";
import type { Lm2Candidate } from "./lm2-model.js";
import {
  type Lm2PendingAllocation,
  type Lm2QuotaLedger,
  lm2PendingTemporaryName,
  lm2QuotaLedgerSchema,
  recordIdentityDigest,
  serializeLm2QuotaLedger,
} from "./lm2-quota-ledger.js";
import {
  anchoredDirectoryIsEmpty,
  closeDirectoryAnchor,
  openDirectoryAnchor,
} from "./lm2-secure-fs.js";
import { vectorSidecarName } from "./lm2-vector-paths.js";

export type Lm2OperationFence = {
  operationId: string;
  lockIdentity: { device: number; inode: number };
  lockToken: string;
};

export type PendingTargetProbe =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; digest: string; serializedBytes: number };

export type Lm2LedgerRecoveryResult =
  | { status: "not_needed"; ledger: Lm2QuotaLedger }
  | { status: "recovered_pending"; ledger: Lm2QuotaLedger; metadataReads: number }
  | { status: "blocked_pending"; ledger: Lm2QuotaLedger; metadataReads: number };

export function lm2DirectoryIsEmpty(path: string): boolean {
  const anchor = openDirectoryAnchor(path, true);
  if (anchor === null) return true;
  try {
    return anchoredDirectoryIsEmpty(anchor);
  } finally {
    closeDirectoryAnchor(anchor);
  }
}

export function parseLm2QuotaLedger(raw: Buffer, workspaceKey: string): Lm2QuotaLedger | null {
  try {
    const parsed = lm2QuotaLedgerSchema.parse(JSON.parse(raw.toString("utf8")));
    return parsed.workspaceKey === workspaceKey &&
      serializeLm2QuotaLedger(parsed) === raw.toString("utf8")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function createPendingAllocations(input: {
  records: readonly Lm2Candidate[];
  modelFingerprint: string;
  firstAllocationSequence: number;
  operationId: string;
}): Lm2PendingAllocation[] {
  return input.records.map((record, index) => ({
    allocationSequence: input.firstAllocationSequence + index,
    modelFingerprint: input.modelFingerprint,
    recordId: record.id,
    recordIdentityDigest: recordIdentityDigest({
      workspaceKey: record.workspaceKey,
      id: record.id,
      kind: record.kind,
      sourceDigest: record.sourceDigest,
      embeddingInputDigest: embeddingInputDigest({ kind: record.kind, text: record.text }),
      modelFingerprint: input.modelFingerprint,
    }),
    reservedBytes: 24 * 1024,
    expectedSidecarDigest: null,
    serializedBytes: null,
    temporaryName: lm2PendingTemporaryName(
      input.operationId,
      input.firstAllocationSequence + index,
    ),
    finalName: vectorSidecarName(record.id),
    phase: "reserved",
  }));
}

function exactTarget(entry: Lm2PendingAllocation, probe: PendingTargetProbe): boolean {
  return (
    probe.status === "valid" &&
    entry.expectedSidecarDigest !== null &&
    entry.serializedBytes !== null &&
    probe.digest === entry.expectedSidecarDigest &&
    probe.serializedBytes === entry.serializedBytes
  );
}

function committedLedger(
  ledger: Lm2QuotaLedger,
  committed: readonly Lm2PendingAllocation[],
): Lm2QuotaLedger {
  const namespaces = new Map(
    ledger.namespaces.map((entry) => [
      entry.modelFingerprint,
      { sidecarCount: entry.sidecarCount, serializedBytes: entry.serializedBytes },
    ]),
  );
  for (const entry of committed) {
    const current = namespaces.get(entry.modelFingerprint) ?? {
      sidecarCount: 0,
      serializedBytes: 0,
    };
    if (entry.serializedBytes === null) throw new Error("unmaterialized committed allocation");
    namespaces.set(entry.modelFingerprint, {
      sidecarCount: current.sidecarCount + 1,
      serializedBytes: current.serializedBytes + entry.serializedBytes,
    });
  }
  const committedThroughAllocation =
    committed.at(-1)?.allocationSequence ?? ledger.committedThroughAllocation;
  return {
    ...ledger,
    namespaces: [...namespaces.entries()]
      .map(([modelFingerprint, allocation]) => ({ modelFingerprint, ...allocation }))
      .sort((left, right) => left.modelFingerprint.localeCompare(right.modelFingerprint)),
    committedThroughAllocation,
    nextAllocationSequence: committedThroughAllocation + 1,
    pending: null,
  };
}

export function advanceLm2Ledger(input: {
  ledger: Lm2QuotaLedger;
  fence: Lm2OperationFence | null;
  pending?: Lm2QuotaLedger["pending"];
}): Lm2QuotaLedger {
  const generation = input.ledger.generation + 1;
  const pending = input.pending === undefined ? input.ledger.pending : input.pending;
  return lm2QuotaLedgerSchema.parse({
    ...input.ledger,
    generation,
    activeOperation:
      input.fence === null
        ? null
        : {
            ...input.fence,
            expectedGeneration: generation,
          },
    pending:
      pending === null
        ? null
        : {
            ...pending,
            expectedGeneration: generation,
          },
  });
}

export function commitFirstPendingAllocation(input: {
  ledger: Lm2QuotaLedger;
  fence: Lm2OperationFence;
}): Lm2QuotaLedger {
  const entry = input.ledger.pending?.entries[0];
  if (entry === undefined || entry.serializedBytes === null) {
    throw new Error("LM2 pending allocation is not materialized");
  }
  const committed = committedLedger(input.ledger, [entry]);
  const remaining = input.ledger.pending?.entries.slice(1) ?? [];
  const firstRemaining = remaining[0];
  const lastRemaining = remaining.at(-1);
  if (remaining.length > 0 && (firstRemaining === undefined || lastRemaining === undefined)) {
    throw new Error("LM2 pending range is incomplete");
  }
  const nextPending =
    firstRemaining === undefined || lastRemaining === undefined
      ? null
      : {
          operationId: input.fence.operationId,
          expectedGeneration: committed.generation,
          firstAllocationSequence: firstRemaining.allocationSequence,
          lastAllocationSequence: lastRemaining.allocationSequence,
          entries: remaining,
        };
  return advanceLm2Ledger({
    ledger: {
      ...committed,
      pending: nextPending,
    },
    fence: input.fence,
  });
}

export function recoverLm2Pending(input: {
  ledger: Lm2QuotaLedger;
  probe(entry: Lm2PendingAllocation): PendingTargetProbe;
  removeTemporary(entry: Lm2PendingAllocation): void;
}): Lm2LedgerRecoveryResult {
  const pending = input.ledger.pending;
  if (pending === null) return { status: "not_needed", ledger: input.ledger };

  const committed: Lm2PendingAllocation[] = [];
  let foundAbsent = false;
  let metadataReads = 0;
  try {
    for (const entry of pending.entries) {
      const probe = input.probe(entry);
      metadataReads += 1;
      if (probe.status === "invalid") {
        return { status: "blocked_pending", ledger: input.ledger, metadataReads };
      }
      if (probe.status === "missing") {
        foundAbsent = true;
      } else if (foundAbsent || !exactTarget(entry, probe)) {
        return { status: "blocked_pending", ledger: input.ledger, metadataReads };
      } else {
        committed.push(entry);
      }
      input.removeTemporary(entry);
    }
  } catch {
    return { status: "blocked_pending", ledger: input.ledger, metadataReads };
  }
  return {
    status: "recovered_pending",
    ledger: committedLedger(input.ledger, committed),
    metadataReads,
  };
}
