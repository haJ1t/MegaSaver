import type { RankedChunk } from "./rank.js";

export const HARD_CEILING_BYTES = 64_000;

export function fitBudget(chunks: readonly RankedChunk[], budget: number): RankedChunk[] {
  const ordered = [...chunks].sort((a, b) => b.score - a.score);
  // Pin the single best exact-intent match (highest-scored chunk that hit an
  // intent token) so budget pressure can never starve the declaration the read
  // was for. Reserve its bytes first, then greedily fill the rest — it still
  // yields to the hard byte budget if it alone overflows.
  const pinned = ordered.find((c) => c.features.keywordScore > 0);
  const kept: RankedChunk[] = [];
  let used = 0;
  if (pinned !== undefined) {
    const cost = Buffer.byteLength(pinned.text, "utf8");
    if (cost <= budget) {
      kept.push(pinned);
      used += cost;
    }
  }
  for (const chunk of ordered) {
    if (chunk === pinned) continue;
    const cost = Buffer.byteLength(chunk.text, "utf8");
    if (used + cost > budget) continue;
    kept.push(chunk);
    used += cost;
  }
  return kept;
}

export function effectiveBudget(maxReturnedBytes: number | undefined, modeBudget: number): number {
  if (maxReturnedBytes === undefined) return modeBudget;
  return Math.min(maxReturnedBytes, HARD_CEILING_BYTES);
}
