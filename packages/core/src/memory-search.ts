import { rankBm25 } from "@megasaver/retrieval";
import type { MemoryEntryId } from "@megasaver/shared";
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

export const memorySearchQuerySchema = z
  .object({
    text: z.string().optional(),
    type: memoryTypeSchema.optional(),
    confidence: memoryConfidenceSchema.optional(),
    scope: memoryScopeSchema.optional(),
    includeStale: z.boolean().default(false),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

// `input` so callers may omit fields with schema defaults (includeStale, limit).
export type MemorySearchQuery = {
  text?: string;
  type?: MemoryType;
  confidence?: MemoryConfidence;
  scope?: MemoryScope;
  includeStale?: boolean;
  limit?: number;
};

// Local, deterministic, offline memory retrieval (Phase 1 / DIMMEM): field
// filters then BM25 over title+content+keywords. No embeddings, no LLM. With no
// text query, returns newest-first (stable by id). Stale entries are excluded
// unless includeStale is set.
export function searchMemoryEntries(
  entries: readonly MemoryEntry[],
  query: MemorySearchQuery,
): MemoryEntry[] {
  const q = memorySearchQuerySchema.parse(query);

  const filtered = entries.filter(
    (entry) =>
      (q.type === undefined || entry.type === q.type) &&
      (q.confidence === undefined || entry.confidence === q.confidence) &&
      (q.scope === undefined || entry.scope === q.scope) &&
      (q.includeStale || !entry.stale),
  );

  const text = q.text?.trim();
  if (text === undefined || text.length === 0) {
    return [...filtered]
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, q.limit);
  }

  const documents = filtered.map((entry) => ({
    id: entry.id,
    text: `${entry.title} ${entry.content} ${entry.keywords.join(" ")}`,
  }));
  const ranked = rankBm25({ query: text, documents, topN: q.limit });
  const byId = new Map(filtered.map((entry) => [entry.id, entry]));
  // score > 0 is intentional: BM25 returns every document up to topN even when
  // a doc shares no term with the query (score 0). A text search should return
  // only actual matches, so zero-overlap docs are dropped here. (A text-less
  // query takes the newest-first branch above and is not affected.)
  return ranked
    .filter((hit) => hit.score > 0)
    .map((hit) => byId.get(hit.id as MemoryEntryId))
    .filter((entry): entry is MemoryEntry => entry !== undefined);
}
