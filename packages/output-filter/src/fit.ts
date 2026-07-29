import type { RankedChunk } from "./rank.js";

export const HARD_CEILING_BYTES = 64_000;

// A3b: the collapse markers normalize.ts emits — `… [repeated N times]` and
// `… [N similar: <template>]`. Each is the ONLY record that a run was folded,
// so a chunk carrying one is not filler: drop it and the model is handed a
// single line with no sign that hundreds more existed, and cannot even know to
// expand. Anchored on a literal, not on `\s*`, so it carries no backtracking
// cost on the hot path (see concepts/unbounded-run-redos).
const EVIDENCE_MARKER = /^… \[(?:repeated \d+ times|\d+ similar: )/m;

export function fitBudget(chunks: readonly RankedChunk[], budget: number): RankedChunk[] {
  const ordered = [...chunks].sort((a, b) => b.score - a.score);
  // Pin the single best exact-intent match (highest-scored chunk that hit an
  // intent token) so budget pressure can never starve the declaration the read
  // was for. Reserve its bytes first, then greedily fill the rest — it still
  // yields to the hard byte budget if it alone overflows.
  const pinned = ordered.find((c) => c.features.keywordScore > 0);
  const kept: RankedChunk[] = [];
  const taken = new Set<RankedChunk>();
  let used = 0;
  const reserve = (chunk: RankedChunk): void => {
    const cost = Buffer.byteLength(chunk.text, "utf8");
    if (used + cost > budget) return;
    kept.push(chunk);
    taken.add(chunk);
    used += cost;
  };

  if (pinned !== undefined) reserve(pinned);
  // Evidence markers rank second, ahead of score: a marker-bearing chunk scores
  // like the noise it summarises, so score order alone reliably drops exactly
  // the chunks whose count evidence is irreplaceable. Each still yields to the
  // budget, and no chunk is admitted that would overflow it.
  for (const chunk of ordered) {
    if (!taken.has(chunk) && EVIDENCE_MARKER.test(chunk.text)) reserve(chunk);
  }
  for (const chunk of ordered) {
    if (!taken.has(chunk)) reserve(chunk);
  }
  return kept;
}

export function effectiveBudget(maxReturnedBytes: number | undefined, modeBudget: number): number {
  if (maxReturnedBytes === undefined) return modeBudget;
  return Math.min(maxReturnedBytes, HARD_CEILING_BYTES);
}
