import { rankBm25 } from "@megasaver/retrieval";
import type { FailedAttemptId } from "@megasaver/shared";
import { z } from "zod";
import type { FailedAttempt } from "./failed-attempt.js";

const DEFAULT_LIMIT = 20;

export const failedAttemptSearchQuerySchema = z
  .object({
    text: z.string().optional(),
    includeConverted: z.boolean().default(false),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

export type FailedAttemptSearchQuery = {
  text?: string;
  includeConverted?: boolean;
  limit?: number;
};

// Local, deterministic, offline failure retrieval (Phase 5 / FORGE): drop
// already-converted failures (they became rules) unless includeConverted, then
// BM25 over task+failedStep+errorOutput+suspectedCause. No text → newest-first,
// stable by id. Mirrors searchMemoryEntries (memory-search.ts).
export function searchFailedAttempts(
  attempts: readonly FailedAttempt[],
  query: FailedAttemptSearchQuery,
): FailedAttempt[] {
  const q = failedAttemptSearchQuerySchema.parse(query);
  const filtered = attempts.filter((a) => q.includeConverted || !a.convertedToRule);

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

  const documents = filtered.map((a) => ({
    id: a.id,
    text: `${a.task} ${a.failedStep} ${a.errorOutput ?? ""} ${a.suspectedCause ?? ""}`,
  }));
  const ranked = rankBm25({ query: text, documents, topN: q.limit });
  const byId = new Map(filtered.map((a) => [a.id, a]));
  return ranked
    .filter((hit) => hit.score > 0)
    .map((hit) => byId.get(hit.id as FailedAttemptId))
    .filter((a): a is FailedAttempt => a !== undefined);
}
