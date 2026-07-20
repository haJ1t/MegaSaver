import { dirname } from "node:path";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import { beginIndexOperation } from "./lm2-index-operation.js";
import type { Lm2IndexDeadline, Lm2IndexOperationResult } from "./lm2-lock.js";
import type {
  EmbeddingPort,
  Lm2Candidate,
  Lm2VectorReadResult,
  ModelDescriptor,
} from "./lm2-model.js";
import {
  MAX_LM2_QUOTA_LEDGER_BYTES,
  lm2QuotaLedgerSchema,
  serializeLm2QuotaLedger,
} from "./lm2-quota-ledger.js";
import {
  anchoredDirectoryIsEmpty,
  closeDirectoryAnchor,
  openDirectoryAnchor,
  readAnchoredFile,
} from "./lm2-secure-fs.js";
import {
  MAX_LM2_DECODED_QUERY_VECTOR_BYTES,
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_SIDECAR_BYTES,
  MAX_LM2_VECTOR_NAMESPACES,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
  parseCandidates,
  parseModel,
} from "./lm2-vector-format.js";
import { embeddingsPath, vectorQuotaLedgerPath } from "./lm2-vector-paths.js";
import { readBoundedVectors } from "./lm2-vector-sidecars.js";

export {
  MAX_LM2_DECODED_QUERY_VECTOR_BYTES,
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_SIDECAR_BYTES,
  MAX_LM2_VECTOR_NAMESPACES,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
} from "./lm2-vector-format.js";
export type { Lm2VerifiedVector } from "./lm2-vector-sidecars.js";

type ReserveAndPublishInput = {
  workspaceKey: string;
  model: ModelDescriptor;
  records: readonly Lm2Candidate[];
  signal: AbortSignal;
  embed: EmbeddingPort["embed"];
};

export type Lm2VectorStoreResult = {
  published: readonly string[];
  reason:
    | null
    | "index_busy"
    | "index_lock_unavailable"
    | "storage_limit"
    | "invalid_vectors"
    | "port_failure"
    | "write_failed";
};

export type Lm2VectorReadRequest = {
  workspaceKey: string;
  model: ModelDescriptor;
  candidates: readonly Lm2Candidate[];
  maxDecodedBytes: number;
  signal: AbortSignal;
  deadlineAtMs: number;
  now: () => number;
};

export type Lm2VectorStore = {
  beginIndexOperation(input: {
    workspaceKey: string;
    model: ModelDescriptor;
    deadline: Lm2IndexDeadline;
  }): Promise<Lm2IndexOperationResult>;
  read(input: Lm2VectorReadRequest): Promise<Lm2VectorReadResult>;
  reserveAndPublish(input: ReserveAndPublishInput): Promise<Lm2VectorStoreResult>;
};

function readDeadlineReached(input: Lm2VectorReadRequest): boolean {
  if (!Number.isFinite(input.deadlineAtMs) || typeof input.now !== "function") {
    throw new Lm2Error("invalid_input", "Invalid LM2 vector read deadline.");
  }
  let current: number;
  try {
    current = input.now();
  } catch {
    throw new Lm2Error("invalid_input", "Invalid LM2 vector read clock.");
  }
  if (!Number.isFinite(current)) {
    throw new Lm2Error("invalid_input", "Invalid LM2 vector read clock.");
  }
  return input.signal.aborted || current >= input.deadlineAtMs;
}

function limitedRead(candidates: readonly Lm2Candidate[]): Lm2VectorReadResult {
  return {
    vectors: [],
    diagnostics: candidates.map(({ id }) => ({ candidateId: id, reason: "vector_read_limit" })),
  };
}

function ledgerSnapshot(storeRoot: string, workspaceKey: string) {
  const path = vectorQuotaLedgerPath(storeRoot, workspaceKey);
  const anchor = openDirectoryAnchor(dirname(path), true);
  if (anchor === null) return null;
  try {
    const read = readAnchoredFile(
      anchor,
      "vector-quota-ledger-v1.json",
      MAX_LM2_QUOTA_LEDGER_BYTES,
    );
    if (read.status !== "valid") return read.status === "missing" ? null : "invalid";
    const text = read.raw.toString("utf8");
    const parsed = lm2QuotaLedgerSchema.safeParse(JSON.parse(text));
    return parsed.success &&
      parsed.data.workspaceKey === workspaceKey &&
      serializeLm2QuotaLedger(parsed.data) === text
      ? parsed.data
      : "invalid";
  } catch {
    return "invalid";
  } finally {
    closeDirectoryAnchor(anchor);
  }
}

function v2State(storeRoot: string, workspaceKey: string): "empty" | "nonempty" | "invalid" {
  const anchor = openDirectoryAnchor(embeddingsPath(storeRoot, workspaceKey), true);
  if (anchor === null) return "empty";
  try {
    return anchoredDirectoryIsEmpty(anchor) ? "empty" : "nonempty";
  } catch {
    return "invalid";
  } finally {
    closeDirectoryAnchor(anchor);
  }
}

export function createLm2VectorStore({ storeRoot }: { storeRoot: string }): Lm2VectorStore {
  const read = async (input: Lm2VectorReadRequest): Promise<Lm2VectorReadResult> => {
    const model = parseModel(input.model);
    const candidates = parseCandidates(
      input.workspaceKey,
      input.candidates,
      MAX_LM2_SIDECARS_PER_NAMESPACE,
    );
    if (
      !Number.isInteger(input.maxDecodedBytes) ||
      input.maxDecodedBytes < 0 ||
      input.maxDecodedBytes > MAX_LM2_DECODED_QUERY_VECTOR_BYTES
    ) {
      throw new Lm2Error("invalid_input", "Invalid LM2 vector read budget.");
    }
    if (readDeadlineReached(input)) return limitedRead(candidates);
    const ledger = ledgerSnapshot(storeRoot, input.workspaceKey);
    if (readDeadlineReached(input)) return limitedRead(candidates);
    if (ledger === "invalid") {
      return {
        vectors: [],
        diagnostics: candidates.map(({ id }) => ({
          candidateId: id,
          reason: "quota_ledger_invalid",
        })),
      };
    }
    if (ledger === null) {
      if (readDeadlineReached(input)) return limitedRead(candidates);
      const state = v2State(storeRoot, input.workspaceKey);
      if (readDeadlineReached(input)) return limitedRead(candidates);
      if (state !== "empty") {
        return {
          vectors: [],
          diagnostics: candidates.map(({ id }) => ({
            candidateId: id,
            reason: "quota_ledger_invalid",
          })),
        };
      }
      return {
        vectors: [],
        diagnostics: candidates.map(({ id }) => ({ candidateId: id, reason: "missing_vectors" })),
      };
    }
    return readBoundedVectors({
      ...input,
      model,
      candidates,
      fingerprint: modelDescriptorFingerprint(model),
      ledger,
      storeRoot,
    });
  };

  return {
    async beginIndexOperation(input) {
      let model: ModelDescriptor;
      try {
        model = parseModel(input.model);
      } catch {
        return { status: "invalid", quotaRecovery: "not_needed" };
      }
      return beginIndexOperation({ ...input, model, storeRoot });
    },
    read,
    async reserveAndPublish(input) {
      const deadline = { signal: input.signal, deadlineAtMs: 15_000, now: () => 0 };
      const operation = await beginIndexOperation({
        storeRoot,
        workspaceKey: input.workspaceKey,
        model: input.model,
        deadline,
      });
      if (operation.status === "busy") return { published: [], reason: "index_busy" };
      if (operation.status !== "ready") return { published: [], reason: "index_lock_unavailable" };
      try {
        const result = await operation.publishBatch({
          records: input.records,
          embed: input.embed,
          assertEgressAllowed: async () => true,
          recheckEvidence: async () => true,
        });
        const reason =
          result.reason === "lock_integrity_lost" || result.reason === "evidence_changed"
            ? "write_failed"
            : result.reason === "remote_approval_denied"
              ? "port_failure"
              : result.reason;
        return { published: result.published, reason };
      } finally {
        await operation.finalize();
      }
    },
  };
}
