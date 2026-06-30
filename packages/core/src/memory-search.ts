import { rankBm25 } from "@megasaver/retrieval";
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import {
  type MemoryConfidence,
  type MemoryEntry,
  type MemoryScope,
  type MemoryType,
  effectiveConfidence,
  isArchived,
  isCurrent,
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
    includeUnapproved: z.boolean().default(false),
    // M2: archival tier is hidden from search by default (aged-out/low-value).
    includeArchival: z.boolean().default(false),
    // Bi-temporal time-travel: filter to memories valid AS OF this instant.
    // Absent ⇒ now ⇒ currently-valid memories only.
    asOf: z.string().datetime({ offset: true }).optional(),
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
  includeUnapproved?: boolean;
  includeArchival?: boolean;
  asOf?: string;
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
  const asOf = q.asOf ?? new Date().toISOString();

  const filtered = entries.filter(
    (entry) =>
      (q.type === undefined || entry.type === q.type) &&
      (q.confidence === undefined || entry.confidence === q.confidence) &&
      (q.scope === undefined || entry.scope === q.scope) &&
      (q.includeStale || !entry.stale) &&
      (q.includeUnapproved || entry.approval === "approved") &&
      (q.includeArchival || !isArchived(entry)) &&
      isCurrent(entry, asOf),
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
  //
  // M2 decay: weight the BM25 score by effectiveConfidence (age + confidence +
  // tier) so an aged/low-confidence memory ranks BELOW a recent/high one at
  // equal lexical overlap. ADDITIVE — every BM25 hit is kept (decay never zeroes
  // a positive score), it only re-orders. Stable tie-break by id.
  const scored = ranked
    .filter((hit) => hit.score > 0)
    .map((hit) => {
      const entry = byId.get(hit.id as MemoryEntryId);
      return entry === undefined
        ? undefined
        : { entry, weighted: hit.score * effectiveConfidence(entry, asOf) };
    })
    .filter((s): s is { entry: MemoryEntry; weighted: number } => s !== undefined);
  return scored
    .sort((a, b) =>
      a.weighted === b.weighted ? a.entry.id.localeCompare(b.entry.id) : b.weighted - a.weighted,
    )
    .map((s) => s.entry);
}
