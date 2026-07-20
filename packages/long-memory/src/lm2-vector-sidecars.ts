import { createHash, randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { join } from "node:path";
import {
  type Lm2LedgerRecoveryResult,
  type Lm2OperationFence,
  advanceLm2Ledger,
  lm2DirectoryIsEmpty,
  parseLm2QuotaLedger,
} from "./lm2-ledger-recovery.js";
import type { Lm2Candidate, Lm2VectorReadResult, ModelDescriptor } from "./lm2-model.js";
import {
  type Lm2PendingAllocation,
  type Lm2QuotaLedger,
  MAX_LM2_QUOTA_LEDGER_BYTES,
  lm2QuotaLedgerSchema,
} from "./lm2-quota-ledger.js";
import {
  type DirectoryAnchor,
  closeDirectoryAnchor,
  openDirectoryAnchor,
  readAnchoredFile,
} from "./lm2-secure-fs.js";
import { unlinkAnchoredFile } from "./lm2-secure-publish.js";
import {
  MAX_LM2_SIDECAR_BYTES,
  type SidecarMetadata,
  decodeSidecarVector,
  isCommittedSidecar,
  matchesCandidate,
  parseSidecarMetadata,
} from "./lm2-vector-format.js";
import {
  embeddingsPath,
  legacyEmbeddingsPath,
  vectorNamespacePath,
  vectorSidecarName,
} from "./lm2-vector-paths.js";

export type Lm2VerifiedVector = {
  candidateId: string;
  vector: number[];
  decodedBytes: number;
};

export type NamedSidecarState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; metadata: SidecarMetadata; digest: string };

export function prepareLm2LedgerOperation(input: {
  storeRoot: string;
  workspaceKey: string;
  ledgerAnchor: DirectoryAnchor;
  fence: Lm2OperationFence;
  lockIdentity: { device: number; inode: number };
  lockToken: string;
  adoptExistingLedger(stat: Stats): void;
  persist(ledger: Lm2QuotaLedger): void;
  recover(ledger: Lm2QuotaLedger): Lm2LedgerRecoveryResult;
}):
  | { status: "ready"; ledger: Lm2QuotaLedger; quotaRecovery: "not_needed" | "recovered_pending" }
  | { status: "invalid" | "blocked" } {
  try {
    if (!lm2DirectoryIsEmpty(legacyEmbeddingsPath(input.storeRoot, input.workspaceKey))) {
      return { status: "invalid" };
    }
    const read = readAnchoredFile(
      input.ledgerAnchor,
      "vector-quota-ledger-v1.json",
      MAX_LM2_QUOTA_LEDGER_BYTES,
    );
    if (read.status === "missing") {
      if (!lm2DirectoryIsEmpty(embeddingsPath(input.storeRoot, input.workspaceKey))) {
        return { status: "invalid" };
      }
      const ledger = lm2QuotaLedgerSchema.parse({
        schemaVersion: 1,
        workspaceKey: input.workspaceKey,
        epoch: randomBytes(32).toString("hex"),
        lockIdentity: input.lockIdentity,
        lockToken: input.lockToken,
        generation: 0,
        namespaces: [],
        committedThroughAllocation: 0,
        nextAllocationSequence: 1,
        activeOperation: { ...input.fence, expectedGeneration: 0 },
        pending: null,
      });
      input.persist(ledger);
      return { status: "ready", ledger, quotaRecovery: "not_needed" };
    }
    if (read.status !== "valid") return { status: "invalid" };
    const ledger = parseLm2QuotaLedger(read.raw, input.workspaceKey);
    if (ledger === null) return { status: "invalid" };
    input.adoptExistingLedger(read.stat);
    if (
      ledger.lockToken !== input.lockToken ||
      ledger.lockIdentity.device !== input.lockIdentity.device ||
      ledger.lockIdentity.inode !== input.lockIdentity.inode
    ) {
      return { status: "invalid" };
    }
    const recovered = input.recover(ledger);
    if (recovered.status === "blocked_pending") return { status: "blocked" };
    const next = advanceLm2Ledger({ ledger: recovered.ledger, fence: input.fence });
    input.persist(next);
    return {
      status: "ready",
      ledger: next,
      quotaRecovery: recovered.status === "recovered_pending" ? "recovered_pending" : "not_needed",
    };
  } catch {
    return { status: "invalid" };
  }
}

export function inspectNamedSidecar(input: {
  storeRoot: string;
  workspaceKey: string;
  fingerprint: string;
  name: string;
}): NamedSidecarState {
  const namespace = openDirectoryAnchor(
    join(embeddingsPath(input.storeRoot, input.workspaceKey), input.fingerprint),
    true,
  );
  if (namespace === null) return { status: "missing" };
  try {
    const read = readAnchoredFile(namespace, input.name, MAX_LM2_SIDECAR_BYTES);
    if (read.status !== "valid") return read;
    const metadata = parseSidecarMetadata(read.raw, input.fingerprint);
    if (metadata === null) return { status: "invalid" };
    return {
      status: "valid",
      metadata,
      digest: createHash("sha256").update(read.raw).digest("hex"),
    };
  } finally {
    closeDirectoryAnchor(namespace);
  }
}

export function removePendingTemporary(input: {
  storeRoot: string;
  workspaceKey: string;
  entry: Lm2PendingAllocation;
}): void {
  const namespace = openDirectoryAnchor(
    join(embeddingsPath(input.storeRoot, input.workspaceKey), input.entry.modelFingerprint),
    true,
  );
  if (namespace === null) return;
  try {
    unlinkAnchoredFile(namespace, input.entry.temporaryName);
  } finally {
    closeDirectoryAnchor(namespace);
  }
}

export function readVerifiedVectors(input: {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  fingerprint: string;
  candidates: readonly Lm2Candidate[];
  maxDecodedBytes: number;
  signal: AbortSignal;
  ledger: Lm2QuotaLedger;
}): Lm2VectorReadResult {
  const vectors: Lm2VerifiedVector[] = [];
  const diagnostics: Lm2VectorReadResult["diagnostics"][number][] = [];
  let decodedBytes = 0;
  for (const candidate of input.candidates) {
    if (input.signal.aborted) return { vectors: [], diagnostics };
    const state = inspectNamedSidecar({
      storeRoot: input.storeRoot,
      workspaceKey: input.workspaceKey,
      fingerprint: input.fingerprint,
      name: vectorSidecarName(candidate.id),
    });
    if (state.status !== "valid") {
      diagnostics.push({
        candidateId: candidate.id,
        reason: state.status === "missing" ? "missing_vectors" : "invalid_vectors",
      });
      continue;
    }
    if (
      !isCommittedSidecar({ ledger: input.ledger, sidecar: state.metadata.sidecar }) ||
      !matchesCandidate(state.metadata, input.workspaceKey, input.model, candidate)
    ) {
      diagnostics.push({ candidateId: candidate.id, reason: "invalid_vectors" });
      continue;
    }
    const vectorBytes = state.metadata.sidecar.dimension * 4;
    if (decodedBytes + vectorBytes > input.maxDecodedBytes) {
      diagnostics.push({ candidateId: candidate.id, reason: "vector_read_limit" });
      continue;
    }
    const vector = decodeSidecarVector(state.metadata);
    if (vector === null) {
      diagnostics.push({ candidateId: candidate.id, reason: "invalid_vectors" });
      continue;
    }
    decodedBytes += vectorBytes;
    vectors.push({ candidateId: candidate.id, vector: [...vector], decodedBytes: vectorBytes });
  }
  if (input.ledger.pending !== null) {
    for (const candidate of input.candidates) {
      diagnostics.push({ candidateId: candidate.id, reason: "quota_recovery_pending" });
    }
  }
  return { vectors, diagnostics };
}

export function existingVectorState(input: {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  fingerprint: string;
  candidate: Lm2Candidate;
  ledger: Lm2QuotaLedger;
}): "missing" | "valid" | "invalid" {
  const state = inspectNamedSidecar({
    storeRoot: input.storeRoot,
    workspaceKey: input.workspaceKey,
    fingerprint: input.fingerprint,
    name: vectorSidecarName(input.candidate.id),
  });
  if (state.status !== "valid") return state.status;
  return matchesCandidate(state.metadata, input.workspaceKey, input.model, input.candidate) &&
    isCommittedSidecar({ ledger: input.ledger, sidecar: state.metadata.sidecar }) &&
    decodeSidecarVector(state.metadata) !== null
    ? "valid"
    : "invalid";
}

export function openVectorNamespace(input: {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
}): DirectoryAnchor | null {
  return openDirectoryAnchor(
    vectorNamespacePath(input.storeRoot, input.workspaceKey, input.model),
    true,
  );
}
