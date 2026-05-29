import type { RankedChunk } from "./rank.js";

export const HARD_CEILING_BYTES = 64_000;

export function fitBudget(chunks: readonly RankedChunk[], budget: number): RankedChunk[] {
  const ordered = [...chunks].sort((a, b) => b.score - a.score);
  const kept: RankedChunk[] = [];
  let used = 0;
  for (const chunk of ordered) {
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
