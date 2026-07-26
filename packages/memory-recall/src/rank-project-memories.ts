import {
  type EmbedFn,
  type MemoryEntry,
  type MemorySearchQuery,
  memoryEmbeddingContentHash,
  memoryEmbeddingsSidecarPath,
  readMemoryEmbeddingHashes,
  searchMemoryEntries,
} from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import {
  type EmbeddingPort,
  type HybridReceipt,
  type Lm2Candidate,
  type Lm2RankVectorReader,
  MAX_LM2_CANDIDATE_TEXT_CODE_UNITS,
  type ModelDescriptor,
  hybridReceiptSchema,
  modelDescriptorFingerprint,
  rankLm2Candidates,
} from "@megasaver/long-memory";
import type { ProjectId } from "@megasaver/shared";
import { memoryCandidate } from "./memory-candidate.js";
import { projectWorkspaceKey } from "./project-workspace-key.js";

const MAX_CANDIDATES = 1_000;
const LOCAL_MODEL: ModelDescriptor = {
  provider: "local",
  modelId: "Xenova/all-MiniLM-L6-v2",
  revision: "transformers-3.3.3",
  dimensions: 384,
  embeddingInputVersion: "lm2-v1",
};

export type RankProjectMemoriesInput = {
  projectId: ProjectId;
  entries: readonly MemoryEntry[];
  task: string;
  storeRoot: string;
  query: MemorySearchQuery;
  embed?: EmbedFn;
  now?: () => number;
};

export type RankProjectMemoriesResult = {
  memory: readonly MemoryEntry[];
  hybrid: HybridReceipt;
};

function candidatesFor(input: RankProjectMemoriesInput): {
  entries: MemoryEntry[];
  candidates: Lm2Candidate[];
  omitted: number;
} {
  if (input.entries.length === 0) {
    return { entries: [], candidates: [], omitted: 0 };
  }
  const entries = searchMemoryEntries(input.entries, {
    ...input.query,
    text: input.task,
    limit: input.entries.length,
  });
  const selected = entries.slice(0, MAX_CANDIDATES);
  const workspaceKey = projectWorkspaceKey(input.projectId);
  return {
    entries: selected,
    candidates: selected.map((entry) => memoryCandidate(entry, workspaceKey)),
    omitted: entries.length - selected.length,
  };
}

function coreFallback(input: RankProjectMemoriesInput): RankProjectMemoriesResult {
  const memory = searchMemoryEntries(input.entries, {
    ...input.query,
    text: input.task,
    limit: Math.min(input.query.limit ?? 20, MAX_CANDIDATES),
  });
  return {
    memory,
    hybrid: hybridReceiptSchema.parse({
      profile: "safe",
      adaptiveCandidateScope: "not_applicable",
      adaptiveCatalogRecordCount: 0,
      candidateInputOmittedCount: 0,
      lexicalCandidateCount: memory.length,
      semanticCandidateCount: 0,
      fusedCandidateCount: memory.length,
      semanticStatus: "not_requested",
      semanticReasons: [],
      indexedVectorCount: 0,
      missingVectorCount: 0,
      invalidVectorCount: 0,
      semanticVectorBytesRead: 0,
      queryLatencyMs: 0,
    }),
  };
}

function vectorReader(input: {
  storeRoot: string;
  projectId: ProjectId;
  entries: readonly MemoryEntry[];
}): { values: Map<string, Float32Array>; reader: Lm2RankVectorReader } {
  const rawValues = readVectors(memoryEmbeddingsSidecarPath(input.storeRoot, input.projectId));
  const hashes = readMemoryEmbeddingHashes(input.storeRoot, input.projectId);
  const entriesById = new Map<string, MemoryEntry>(input.entries.map((entry) => [entry.id, entry]));
  const values = new Map(
    [...rawValues].filter(([id]) => {
      const entry = entriesById.get(id);
      return entry !== undefined && hashes.get(id) === memoryEmbeddingContentHash(entry);
    }),
  );
  return {
    values,
    reader: {
      async read(request) {
        const vectors: { candidateId: string; vector: number[]; decodedBytes: number }[] = [];
        const diagnostics: { candidateId: string; reason: "missing_vectors" }[] = [];
        for (const candidate of request.candidates) {
          const vector = values.get(candidate.id);
          if (vector === undefined) {
            diagnostics.push({ candidateId: candidate.id, reason: "missing_vectors" });
          } else {
            vectors.push({
              candidateId: candidate.id,
              vector: Array.from(vector),
              decodedBytes: vector.byteLength,
            });
          }
        }
        return { vectors, diagnostics };
      },
    },
  };
}

function localEmbedding(embedFn: EmbedFn): EmbeddingPort {
  const fingerprint = modelDescriptorFingerprint(LOCAL_MODEL);
  return {
    egress: "local" as const,
    async embed(input: { texts: readonly string[] }) {
      return {
        modelFingerprint: fingerprint,
        vectors: (await embedFn(input.texts)).map((vector) => Array.from(vector)),
      };
    },
  };
}

export async function rankProjectMemories(
  input: RankProjectMemoriesInput,
): Promise<RankProjectMemoriesResult> {
  const prepared = candidatesFor(input);
  if (
    input.task.trim().length > MAX_LM2_CANDIDATE_TEXT_CODE_UNITS ||
    prepared.candidates.some(
      (candidate) => candidate.text.length > MAX_LM2_CANDIDATE_TEXT_CODE_UNITS,
    )
  ) {
    return coreFallback(input);
  }
  const workspaceKey = projectWorkspaceKey(input.projectId);
  const byId = new Map<string, MemoryEntry>(prepared.entries.map((entry) => [entry.id, entry]));
  const memoryFor = (ids: readonly string[]) =>
    ids
      .flatMap((id) => {
        const entry = byId.get(id);
        return entry === undefined ? [] : [entry];
      })
      .slice(0, input.query.limit ?? 20);
  const rankSafe = () =>
    rankLm2Candidates({
      candidates: prepared.candidates,
      request: { workspaceKey, task: input.task, profile: "safe" },
      vectors: {
        async read() {
          return { vectors: [], diagnostics: [] };
        },
      },
      embedding: localEmbedding(input.embed ?? embed),
      clock: { now: input.now ?? (() => performance.now()) },
      adaptiveCandidateScope: "lm2_capture_window",
      candidateInputOmittedCount: prepared.omitted,
    });
  let vectors: ReturnType<typeof vectorReader>;
  try {
    vectors = vectorReader({
      storeRoot: input.storeRoot,
      projectId: input.projectId,
      entries: prepared.entries,
    });
  } catch {
    const ranked = await rankSafe();
    return { memory: memoryFor(ranked.orderedCandidateIds), hybrid: ranked.hybrid };
  }
  const profile = vectors.values.size === 0 ? "safe" : "adaptive";
  const ranked = await rankLm2Candidates({
    candidates: prepared.candidates,
    request: {
      workspaceKey,
      task: input.task,
      profile,
      ...(profile === "adaptive" ? { model: LOCAL_MODEL } : {}),
    },
    vectors: vectors.reader,
    embedding: localEmbedding(input.embed ?? embed),
    clock: { now: input.now ?? (() => performance.now()) },
    adaptiveCandidateScope: "lm2_capture_window",
    candidateInputOmittedCount: prepared.omitted,
  });
  if (ranked.hybrid.semanticStatus === "degraded") {
    const safe = await rankSafe();
    return { memory: memoryFor(safe.orderedCandidateIds), hybrid: safe.hybrid };
  }
  return {
    memory: memoryFor(ranked.orderedCandidateIds),
    hybrid: ranked.hybrid,
  };
}
import { performance } from "node:perf_hooks";
