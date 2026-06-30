import { cosine } from "@megasaver/embeddings";
import { z } from "zod";
import {
  type MemoryConfidence,
  type MemoryEntry,
  type MemoryScope,
  type MemoryType,
  memoryConfidenceSchema,
  memoryScopeSchema,
  memoryTypeSchema,
} from "./memory-entry.js";

const DEFAULT_LIMIT = 20;

// Same field filters as BM25 searchMemoryEntries — the semantic variant differs
// only in ranking (cosine over an injected query/memory vector pair). The async
// embed of the query happens at the boundary (recall.ts / get-relevant-memories.ts);
// this function is synchronous and takes pre-computed vectors.
export const semanticMemorySearchQuerySchema = z
  .object({
    type: memoryTypeSchema.optional(),
    confidence: memoryConfidenceSchema.optional(),
    scope: memoryScopeSchema.optional(),
    includeStale: z.boolean().default(false),
    includeUnapproved: z.boolean().default(false),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

export type SemanticMemorySearchQuery = {
  queryVector: Float32Array;
  memoryVectors: Map<string, Float32Array>;
  type?: MemoryType;
  confidence?: MemoryConfidence;
  scope?: MemoryScope;
  includeStale?: boolean;
  includeUnapproved?: boolean;
  limit?: number;
};

// Vector recall over memories: filter (same gates as BM25) → cosine-rank by the
// memory's sidecar vector against the query vector, descending. A memory with no
// sidecar vector cannot be ranked and is dropped (the boundary falls back to BM25
// when the sidecar is empty). Ties break by id for a stable order.
export function searchMemoryEntriesSemantic(
  entries: readonly MemoryEntry[],
  query: SemanticMemorySearchQuery,
): MemoryEntry[] {
  const { queryVector, memoryVectors } = query;
  const q = semanticMemorySearchQuerySchema.parse({
    ...(query.type !== undefined ? { type: query.type } : {}),
    ...(query.confidence !== undefined ? { confidence: query.confidence } : {}),
    ...(query.scope !== undefined ? { scope: query.scope } : {}),
    ...(query.includeStale !== undefined ? { includeStale: query.includeStale } : {}),
    ...(query.includeUnapproved !== undefined
      ? { includeUnapproved: query.includeUnapproved }
      : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  });

  const scored: { entry: MemoryEntry; score: number }[] = [];
  for (const entry of entries) {
    if (q.type !== undefined && entry.type !== q.type) continue;
    if (q.confidence !== undefined && entry.confidence !== q.confidence) continue;
    if (q.scope !== undefined && entry.scope !== q.scope) continue;
    if (!q.includeStale && entry.stale) continue;
    if (!q.includeUnapproved && entry.approval !== "approved") continue;
    const vector = memoryVectors.get(entry.id);
    if (vector === undefined) continue;
    scored.push({ entry, score: cosine(queryVector, vector) });
  }

  return scored
    .sort((a, b) =>
      a.score === b.score ? a.entry.id.localeCompare(b.entry.id) : b.score - a.score,
    )
    .slice(0, q.limit)
    .map((s) => s.entry);
}
