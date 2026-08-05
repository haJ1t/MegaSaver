// Proxy Mode v1.2 §11 small-output passthrough thresholds (in tokens).
// Below the passthrough threshold a wrapper would cost more than it
// saves; between the two we return a light summary plus raw; at or
// above the hard-wrap threshold we run full compression.
export const PASSTHROUGH_THRESHOLD_TOKENS = 1200;
export const HARD_WRAP_THRESHOLD_TOKENS = 2000;

export type FilterDecision =
  | "passthrough"
  | "light"
  | "compressed"
  | "unchanged-marker"
  | "outline";

// Heuristic ~4 bytes per token. Good enough for threshold gating and
// savings reporting; we never bill a model off this number.
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

// `patStr` is the regex the encoder splits on before merging. Reading it from
// the encoder rather than restating it is deliberate: three earlier designs
// bounded this cost by modelling that partition, and each was defeated by an
// input class outside the model — one of them by restating GPT-2's pattern,
// which lacks cl100k's whitespace branches entirely.
//
// It is an own property at runtime but absent from js-tiktoken's published
// types, so it is read defensively: without it the encode cannot be bounded,
// and countTokens declines rather than encoding unbounded. test/tokens.test.ts
// asserts the shipped version still exposes it, so an upgrade that drops it
// turns red instead of silently zeroing coverage.
type TiktokenEncoding = { encode(text: string): number[]; patStr?: unknown };

// B4: real BPE count for REPORTED numbers (cl100k_base — the provider's exact
// tokenizer is not public; this is the standard approximation and its
// divergence from bytes/4 is measured in bench-replay/src/token-divergence).
// estimateTokens stays the hot-path gate — it runs on every tool call and
// must never pay the multi-MB ranks load. The encoding is memoized after the
// first call and lazy-dynamic-imported so importing output-filter stays cheap
// (guarded by test/tokens-real.test.ts "no eager js-tiktoken load").
let encodingPromise: Promise<TiktokenEncoding> | null = null;

function loadEncoding(): Promise<TiktokenEncoding> {
  encodingPromise ??= import("js-tiktoken").then(
    (m) => m.getEncoding("cl100k_base") as unknown as TiktokenEncoding,
  );
  return encodingPromise;
}

// `bytePairMerge` is quadratic in the UTF-8 byte length of each regex match, so
// cost per byte rises linearly with the size of the largest match, and a
// per-match overhead dominates below ~16 bytes. Swept 2026-08-05 over eight
// content classes (ASCII letters, mixed-case words, digits, punctuation and
// box-drawing, NFD accented Latin, CJK, whitespace runs) and eleven match
// sizes:
//
//   cost <= (MATCH_OVERHEAD_BYTES + maxMatchBytes) * totalBytes * 0.137 us
//
// Both terms are load-bearing, each for a shape that defeated an earlier
// design. Without the floor term, `"a1"` repeated has a one-byte largest match
// and is admitted at 5 MB, where it takes 1.3 s. Without counting whitespace
// matches, 32 KB of newlines scores zero work and takes 46 s — cl100k matches
// a whitespace run as ONE match, so whitespace is not free.
export const MATCH_OVERHEAD_BYTES = 4;
// 750_000 us (half the 1500 ms per-tool-call ceiling, because record-output
// runs two synchronous counters and they add) / 0.137 us per unit = 5_474_452,
// divided by 3 for machine headroom.
export const MAX_WORK_UNITS = 1_800_000;

// UTF-8 byte length is never below UTF-16 code-unit length, so an over-long
// string is refused before paying the multi-MB ranks load.
const MAX_ADMISSIBLE_BYTES = MAX_WORK_UNITS / (MATCH_OVERHEAD_BYTES + 1);

let patternCache: RegExp | null = null;

// The decline decision, exposed so tests can assert it directly rather than
// infer it from a stopwatch. Returns null when the pattern is unavailable —
// see TiktokenEncoding.
export async function tokenWorkUnits(text: string): Promise<number | null> {
  const encoding = await loadEncoding();
  if (patternCache === null) {
    if (typeof encoding.patStr !== "string") return null;
    patternCache = new RegExp(encoding.patStr, "gu");
  }

  let totalBytes = 0;
  let maxMatchBytes = 0;
  for (const match of text.matchAll(patternCache)) {
    const bytes = Buffer.byteLength(match[0], "utf8");
    totalBytes += bytes;
    if (bytes > maxMatchBytes) maxMatchBytes = bytes;
  }
  return (MATCH_OVERHEAD_BYTES + maxMatchBytes) * totalBytes;
}

// null means ABOVE THE WORK BUDGET, deliberately not measured — never zero,
// never an estimate. Callers omit the token fields rather than substitute a
// value. A returned number is the encoder's own count for the whole string:
// nothing is chunked, so it is exact.
export async function countTokens(text: string): Promise<number | null> {
  if (text.length > MAX_ADMISSIBLE_BYTES) return null;

  const work = await tokenWorkUnits(text);
  if (work === null || work > MAX_WORK_UNITS) return null;

  return (await loadEncoding()).encode(text).length;
}
