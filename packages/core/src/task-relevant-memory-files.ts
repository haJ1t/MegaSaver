import { cosine, embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { type EmbedFn, memoryEmbeddingsSidecarPath } from "./embed-memory.js";
import type { MemoryEntry } from "./memory-entry.js";

const DEFAULT_TOP_K = 10;
// A small cosine floor below which a memory is too far from the task to count.
// Cosine over the embedder's normalized vectors is roughly in [-1, 1]; 0.1 drops
// the clearly-orthogonal without pruning genuinely-related memories.
const DEFAULT_FLOOR = 0.1;

export type TaskRelevantMemoryFilesOptions = {
  taskVector: Float32Array;
  memoryVectors: Map<string, Float32Array>;
  topK?: number;
  floor?: number;
};

// Pure: rank the approved, non-stale memories that have a sidecar vector by
// cosine(taskVector, memoryVector), keep the top-K above `floor`, and return the
// deduped, order-stable union of THEIR relatedFiles. The task-scoped feed for the
// context-pruner's memoryRelevance factor — the narrowed counterpart of
// approvedMemoryFiles (which returns ALL approved files). Eligibility mirrors
// approvedMemoryFiles EXACTLY so the scoped set is always a task-filtered subset
// of what the fallback would include — never stricter. Task relevance (cosine
// top-K above floor) is the ONLY narrowing. Making eligibility current/tier-aware
// is a future change to approvedMemoryFiles itself, applied uniformly to BOTH
// paths, not divergently here. Deterministic: ties break by id.
export function taskRelevantMemoryFiles(
  memories: readonly MemoryEntry[],
  options: TaskRelevantMemoryFilesOptions,
): string[] {
  const { taskVector, memoryVectors } = options;
  const topK = options.topK ?? DEFAULT_TOP_K;
  const floor = options.floor ?? DEFAULT_FLOOR;

  const scored: { entry: MemoryEntry; score: number }[] = [];
  for (const entry of memories) {
    if (entry.approval !== "approved" || entry.stale) continue;
    const vector = memoryVectors.get(entry.id);
    if (vector === undefined) continue;
    const score = cosine(taskVector, vector);
    if (score < floor) continue;
    scored.push({ entry, score });
  }

  const selected = scored
    .sort((a, b) =>
      a.score === b.score ? a.entry.id.localeCompare(b.entry.id) : b.score - a.score,
    )
    .slice(0, topK);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const { entry } of selected) {
    for (const file of entry.relatedFiles ?? []) {
      if (!seen.has(file)) {
        seen.add(file);
        out.push(file);
      }
    }
  }
  return out;
}

export type TaskScopedMemoryFilesOptions = {
  storeRoot: string;
  projectId: ProjectId;
  memories: readonly MemoryEntry[];
  task: string;
  // The task vector the caller already computed (the context pruner embeds the
  // task for the code-block signal). Reused so we never embed the task twice.
  taskVector?: Float32Array;
  topK?: number;
  floor?: number;
  embedFn?: EmbedFn;
};

// Best-effort: load the project's memory-vector sidecar, obtain a task vector
// (the injected one, else embed `task`), and return the task-scoped memory files.
// Returns null on no/empty sidecar, no task vector, or ANY failure — the boundary
// then falls back to approvedMemoryFiles (all approved), so no-sidecar behavior is
// unchanged and the signal is never lost. Never throws. Mirrors the established
// best-effort boundary in get-relevant-memories.ts / embeddingSignalFor.
export async function taskScopedMemoryFiles(
  options: TaskScopedMemoryFilesOptions,
): Promise<string[] | null> {
  try {
    const memoryVectors = readVectors(
      memoryEmbeddingsSidecarPath(options.storeRoot, options.projectId),
    );
    if (memoryVectors.size === 0) return null;
    let taskVector = options.taskVector;
    if (taskVector === undefined) {
      const [embedded] = await (options.embedFn ?? embed)([options.task]);
      if (embedded === undefined) return null;
      taskVector = embedded;
    }
    return taskRelevantMemoryFiles(options.memories, {
      taskVector,
      memoryVectors,
      ...(options.topK !== undefined ? { topK: options.topK } : {}),
      ...(options.floor !== undefined ? { floor: options.floor } : {}),
    });
  } catch {
    return null;
  }
}
