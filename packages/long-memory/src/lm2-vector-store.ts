import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import { withWorkspaceIndexLock } from "./lm2-lock.js";
import type { EmbeddingPort, Lm2Candidate, ModelDescriptor } from "./lm2-model.js";
import { closeDirectoryAnchor } from "./lm2-secure-fs.js";
import {
  MAX_LM2_DECODED_QUERY_VECTOR_BYTES,
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_SIDECAR_BYTES,
  MAX_LM2_VECTOR_NAMESPACES,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
  buildSerializedSidecar,
  canonicalEmbeddingInput,
  parseCandidates,
  parseModel,
} from "./lm2-vector-format.js";
import { ensureIndexLockPath, ensureVectorNamespace } from "./lm2-vector-paths.js";
import {
  type Lm2VerifiedVector,
  existingVectorState,
  inspectVectorQuota,
  publishVectorSidecar,
  readVerifiedVectors,
} from "./lm2-vector-sidecars.js";

export {
  MAX_LM2_DECODED_QUERY_VECTOR_BYTES,
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_SIDECAR_BYTES,
  MAX_LM2_VECTOR_NAMESPACES,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
} from "./lm2-vector-format.js";
export type { Lm2VerifiedVector } from "./lm2-vector-sidecars.js";

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

type ReserveAndPublishInput = {
  workspaceKey: string;
  model: ModelDescriptor;
  records: readonly Lm2Candidate[];
  signal: AbortSignal;
  embed: EmbeddingPort["embed"];
};

export type Lm2VectorStore = {
  readVerified(input: {
    workspaceKey: string;
    model: ModelDescriptor;
    candidates: readonly Lm2Candidate[];
    maxDecodedBytes: number;
    signal: AbortSignal;
  }): Promise<readonly Lm2VerifiedVector[]>;
  reserveAndPublish(input: ReserveAndPublishInput): Promise<Lm2VectorStoreResult>;
};

function invalidResultReason(error: unknown): "invalid_vectors" | "storage_limit" {
  return error instanceof Lm2Error && error.code === "write_failed"
    ? "storage_limit"
    : "invalid_vectors";
}

function resultShape(result: unknown): {
  modelFingerprint: unknown;
  vectors: unknown[];
} | null {
  try {
    if (typeof result !== "object" || result === null) return null;
    const candidate = result as { modelFingerprint?: unknown; vectors?: unknown };
    return Array.isArray(candidate.vectors)
      ? { modelFingerprint: candidate.modelFingerprint, vectors: candidate.vectors }
      : null;
  } catch {
    return null;
  }
}

export function createLm2VectorStore({ storeRoot }: { storeRoot: string }): Lm2VectorStore {
  return {
    async readVerified({ workspaceKey, model, candidates, maxDecodedBytes, signal }) {
      const parsedModel = parseModel(model);
      const parsedCandidates = parseCandidates(
        workspaceKey,
        candidates,
        MAX_LM2_SIDECARS_PER_NAMESPACE,
      );
      if (
        !Number.isInteger(maxDecodedBytes) ||
        maxDecodedBytes < 0 ||
        maxDecodedBytes > MAX_LM2_DECODED_QUERY_VECTOR_BYTES
      ) {
        throw new Lm2Error("invalid_input", "Invalid LM2 vector read budget.");
      }
      return readVerifiedVectors({
        storeRoot,
        workspaceKey,
        model: parsedModel,
        candidates: parsedCandidates,
        maxDecodedBytes,
        signal,
      });
    },

    async reserveAndPublish(input) {
      let model: ModelDescriptor;
      let records: Lm2Candidate[];
      try {
        model = parseModel(input.model);
        records = parseCandidates(input.workspaceKey, input.records, 256);
      } catch {
        return { published: [], reason: "write_failed" };
      }

      let lockPath: string;
      try {
        lockPath = ensureIndexLockPath(storeRoot, input.workspaceKey);
      } catch {
        return { published: [], reason: "index_lock_unavailable" };
      }

      try {
        return await withWorkspaceIndexLock(lockPath, async () => {
          const fingerprint = modelDescriptorFingerprint(model);
          let quota: ReturnType<typeof inspectVectorQuota>;
          const planned: Lm2Candidate[] = [];
          try {
            quota = inspectVectorQuota(storeRoot, input.workspaceKey, fingerprint);
            for (const record of records) {
              const state = existingVectorState({
                storeRoot,
                workspaceKey: input.workspaceKey,
                model,
                fingerprint,
                candidate: record,
              });
              if (state === "invalid") return { published: [], reason: "write_failed" } as const;
              if (state === "missing") planned.push(record);
            }
          } catch {
            return { published: [], reason: "write_failed" } as const;
          }
          if (planned.length === 0) return { published: [], reason: null } as const;

          const newNamespace = !quota.activeNamespaces.has(fingerprint);
          if (
            quota.activeNamespaces.size + (newNamespace ? 1 : 0) > MAX_LM2_VECTOR_NAMESPACES ||
            quota.requestedNamespaceCount + planned.length > MAX_LM2_SIDECARS_PER_NAMESPACE ||
            quota.serializedBytes + planned.length * MAX_LM2_SIDECAR_BYTES >
              MAX_LM2_WORKSPACE_VECTOR_BYTES
          ) {
            return { published: [], reason: "storage_limit" } as const;
          }
          if (input.signal.aborted) return { published: [], reason: "port_failure" } as const;

          let namespace: ReturnType<typeof ensureVectorNamespace>;
          try {
            namespace = ensureVectorNamespace(storeRoot, input.workspaceKey, model);
          } catch {
            return { published: [], reason: "write_failed" } as const;
          }
          try {
            let portResult: unknown;
            try {
              portResult = await input.embed({
                model,
                purpose: "document",
                texts: planned.map(canonicalEmbeddingInput),
                signal: input.signal,
              });
            } catch {
              return { published: [], reason: "port_failure" } as const;
            }
            if (input.signal.aborted) return { published: [], reason: "port_failure" } as const;
            const shaped = resultShape(portResult);
            if (
              shaped === null ||
              shaped.modelFingerprint !== fingerprint ||
              shaped.vectors.length !== planned.length
            ) {
              return { published: [], reason: "invalid_vectors" } as const;
            }

            const serialized: string[] = [];
            try {
              for (let index = 0; index < planned.length; index += 1) {
                const values = shaped.vectors[index];
                if (!Array.isArray(values)) {
                  throw new Lm2Error("invalid_vectors", "Invalid embedding vector tuple.");
                }
                serialized.push(
                  buildSerializedSidecar(model, planned[index] as Lm2Candidate, values),
                );
              }
            } catch (error) {
              return { published: [], reason: invalidResultReason(error) } as const;
            }

            const published: string[] = [];
            for (let index = 0; index < planned.length; index += 1) {
              if (input.signal.aborted) return { published, reason: "port_failure" } as const;
              try {
                publishVectorSidecar(
                  namespace,
                  (planned[index] as Lm2Candidate).id,
                  serialized[index] as string,
                );
              } catch {
                return { published, reason: "write_failed" } as const;
              }
              published.push((planned[index] as Lm2Candidate).id);
            }
            return { published, reason: null } as const;
          } finally {
            closeDirectoryAnchor(namespace);
          }
        });
      } catch (error) {
        if (error instanceof Lm2Error && error.code === "index_busy") {
          return { published: [], reason: "index_busy" };
        }
        return { published: [], reason: "index_lock_unavailable" };
      }
    },
  };
}
