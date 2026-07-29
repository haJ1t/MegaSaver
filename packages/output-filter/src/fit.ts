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

// A4 (§W1): how much of the input each mode aims to return. The mode budget
// stays as the CEILING — the most that may ever be returned — and this is the
// TARGET, expressed relative to the input.
//
// Without it the ceiling was doing both jobs, and since the eligibility floor
// was the same constant, an input that only just cleared the floor was allowed
// to fill essentially all of it: 12.5 KB of distinct source in balanced mode
// returned 10.5 KB, a 16% saving for a full rank-and-fit pass. The saving was a
// function of how far the input happened to exceed a constant, not of how much
// of it the reader needed.
//
// Values are the share of the input each mode returns. safe keeps half —
// it is the evidence-preserving mode and §12 forbids aggressive compression
// there; aggressive keeps an eighth. They are deliberately coarse: this is a
// policy dial, and a precise-looking constant would imply a measurement that
// has not been made.
const MODE_TARGET_RATIO: Record<string, number> = {
  aggressive: 0.125,
  balanced: 0.25,
  safe: 0.5,
};

// The budget the fit step actually fills: the smaller of "this share of the
// input" and "the most this mode may ever return". A caller-supplied
// maxReturnedBytes still wins — it is an explicit instruction, not a default.
export function targetBudget(input: {
  rawBytes: number;
  mode: string;
  modeBudget: number;
  maxReturnedBytes: number | undefined;
}): number {
  if (input.maxReturnedBytes !== undefined) {
    return Math.min(input.maxReturnedBytes, HARD_CEILING_BYTES);
  }
  const ratio = MODE_TARGET_RATIO[input.mode] ?? 1;
  // Never target below the smallest useful excerpt: a target of a few hundred
  // bytes on a small input would return a summary and nothing else, which is
  // the "no-blind" failure the fallback in types.ts exists to prevent.
  const target = Math.max(MIN_TARGET_BYTES, Math.floor(input.rawBytes * ratio));
  return Math.min(target, input.modeBudget);
}

export const MIN_TARGET_BYTES = 1_024;
