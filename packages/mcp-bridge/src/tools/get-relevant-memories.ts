import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  memoryEmbeddingsSidecarPath,
  searchMemoryEntriesSemantic,
} from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

// embedFn is injectable so the boundary can be unit-tested with a fake — no model
// in CI. storeRoot locates the per-project memory-vector sidecar; absent ⇒ the
// semantic signal is skipped and BM25 is used.
export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>;
export type GetRelevantMemoriesEnv = {
  registry: CoreRegistry;
  storeRoot?: string;
  embedFn?: EmbedFn;
};

const getRelevantMemoriesInputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type GetRelevantMemoriesResult = { memory: readonly MemoryEntry[] };

// Best-effort semantic ranking: returns vector-ranked memories ONLY when a
// non-empty sidecar exists for the project AND embedding the task succeeds. Any
// failure (no storeRoot, no sidecar, model absent, embed throws) returns null so
// the caller falls back to BM25. Never throws. Mirrors embeddingSignalFor in
// context-pruning.ts.
async function semanticMemoryRanking(
  env: GetRelevantMemoriesEnv,
  projectId: ProjectId,
  task: string,
  limit: number | undefined,
): Promise<MemoryEntry[] | null> {
  if (env.storeRoot === undefined) return null;
  try {
    const memoryVectors = readVectors(memoryEmbeddingsSidecarPath(env.storeRoot, projectId));
    if (memoryVectors.size === 0) return null;
    const [queryVector] = await (env.embedFn ?? embed)([task]);
    if (queryVector === undefined) return null;
    const entries = env.registry.listMemoryEntries(projectId);
    return searchMemoryEntriesSemantic(entries, {
      queryVector,
      memoryVectors,
      ...(limit !== undefined ? { limit } : {}),
    });
  } catch {
    return null;
  }
}

// Free-text task → top-N relevant memories. Semantic (cosine over the memory
// sidecar) when available, gracefully falling back to BM25 over title+content+
// keywords (the same offline ranker as `mega memory search`).
export async function handleGetRelevantMemories(
  env: GetRelevantMemoriesEnv,
  rawArgs: unknown,
): Promise<GetRelevantMemoriesResult> {
  const parsed = getRelevantMemoriesInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, limit } = parsed.data;

  try {
    const semantic = await semanticMemoryRanking(env, projectId as ProjectId, task, limit);
    if (semantic !== null) return { memory: semantic };
    const memory = env.registry.searchMemoryEntries(projectId as ProjectId, {
      text: task,
      ...(limit !== undefined ? { limit } : {}),
    });
    return { memory };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
