import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  isCurrent,
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
    // Bi-temporal time-travel: rank memories valid AS OF this instant.
    // Absent ⇒ now ⇒ currently-valid only.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type GetRelevantMemoriesResult = { memory: readonly MemoryEntry[] };

// Best-effort semantic ranking: returns vector-ranked memories ONLY when a
// sidecar with FULL coverage of the candidate memories exists AND embedding the
// task succeeds. Any failure (no storeRoot, no/partial sidecar, model absent,
// embed throws) returns null so the caller falls back to BM25. Never throws.
// Mirrors embeddingSignalFor in context-pruning.ts.
//
// Full-coverage guard: searchMemoryEntriesSemantic drops any candidate whose
// vector is missing. No production path embeds on write, so a memory created or
// approved after the last manual sidecar build is un-vectored — the default
// steady state is PARTIAL coverage. Ranking a partial sidecar would silently
// omit a real approved memory. So if any candidate lacks a vector, fall back to
// BM25 (which returns all matches): results are either full-coverage semantic OR
// BM25, never a silently-truncated mix.
async function semanticMemoryRanking(
  env: GetRelevantMemoriesEnv,
  projectId: ProjectId,
  task: string,
  limit: number | undefined,
  asOf: string,
): Promise<MemoryEntry[] | null> {
  if (env.storeRoot === undefined) return null;
  try {
    const memoryVectors = readVectors(memoryEmbeddingsSidecarPath(env.storeRoot, projectId));
    if (memoryVectors.size === 0) return null;
    const entries = env.registry.listMemoryEntries(projectId);
    // The same filter searchMemoryEntriesSemantic applies by default: approved,
    // non-stale, current-as-of. A candidate missing a vector means partial
    // coverage → BM25. The asOf gate must match so a closed (non-current) memory
    // without a vector does not force a needless BM25 fallback.
    const candidates = entries.filter(
      (e) => e.approval === "approved" && !e.stale && isCurrent(e, asOf),
    );
    if (candidates.some((e) => !memoryVectors.has(e.id))) return null;
    const [queryVector] = await (env.embedFn ?? embed)([task]);
    if (queryVector === undefined) return null;
    return searchMemoryEntriesSemantic(entries, {
      queryVector,
      memoryVectors,
      asOf,
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
  const { projectId, task, limit, asOf } = parsed.data;
  const at = asOf ?? new Date().toISOString();

  try {
    const semantic = await semanticMemoryRanking(env, projectId as ProjectId, task, limit, at);
    if (semantic !== null) return { memory: semantic };
    const memory = env.registry.searchMemoryEntries(projectId as ProjectId, {
      text: task,
      asOf: at,
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
