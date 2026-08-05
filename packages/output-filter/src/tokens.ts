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
// input class outside the model — one of them by restating a pattern from a
// different encoding, whose `\p{N}{1,3}` and `[\r\n]*` branches differ from
// the one actually driving the merge.
//
// It is an own property at runtime but absent from js-tiktoken's published
// types, so it is read defensively: without it the encode cannot be bounded,
// and countTokens declines rather than encoding unbounded. test/tokens.test.ts
// asserts the shipped version still exposes it, so an upgrade that drops it
// turns red instead of silently zeroing coverage.
type TiktokenEncoding = {
  encode(text: string, allowedSpecial?: string[], disallowedSpecial?: string[]): number[];
  patStr?: unknown;
};

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
//   cost <= SUM over matches of (MATCH_OVERHEAD_BYTES + bytes) * bytes * k
//
// The sum is per match, NOT `maxMatchBytes * totalBytes`. A global max times a
// global total lets one outlier poison every unrelated byte: 50 KB of clean log
// containing a single 800-byte base64 line scored 22.7x the budget under that
// form and was declined, though it encodes in 31.8 ms.
//
// Both terms are load-bearing, each for a shape that defeated an earlier
// design. Without the per-match floor, `"a1"` repeated is admitted far past
// budget on match count alone. Without counting whitespace matches, 32 KB of
// newlines scores zero work and takes 46 s — cl100k matches a whitespace run
// as ONE match, so whitespace is not free.
export const MATCH_OVERHEAD_BYTES = 4;
// Measured 2026-08-06 over fifteen shapes spanning four scripts, two binary
// encodings, whitespace runs, high-match-count input and mixed content: worst
// k = 0.0462 us/unit (punctuated Japanese). 750_000 us — half the 1500 ms
// per-tool-call ceiling, because record-output runs two synchronous counters
// and they add — divided by 0.0462 is 16_227_553, divided by 3 for machine
// headroom. Worst-case encode at the cap is then ~231 ms.
export const MAX_WORK_UNITS = 5_000_000;

// Every match contributes at least (MATCH_OVERHEAD_BYTES + 1) * 1 per byte, so
// work >= 5 * totalBytes and an over-long string can be refused before paying
// the multi-MB ranks load. UTF-8 byte length is never below UTF-16 code-unit
// length, so comparing text.length only ever declines conservatively.
const MAX_ADMISSIBLE_BYTES = MAX_WORK_UNITS / (MATCH_OVERHEAD_BYTES + 1);

let patternCache: RegExp | null = null;

// The decline decision, exposed so tests can assert it directly rather than
// infer it from a stopwatch. Returns null when the pattern is unavailable —
// see TiktokenEncoding.
export async function tokenWorkUnits(text: string): Promise<number | null> {
  // The pre-check lives here, not only in countTokens: this is exported, and an
  // external caller must not get an unbounded matchAll over an arbitrary
  // string. Any length past the cap is over budget by construction, so
  // reporting the cap + 1 is both cheap and monotone.
  if (text.length > MAX_ADMISSIBLE_BYTES) return MAX_WORK_UNITS + 1;

  const encoding = await loadEncoding();
  if (patternCache === null) {
    if (typeof encoding.patStr !== "string") return null;
    patternCache = new RegExp(encoding.patStr, "gu");
  }

  let work = 0;
  for (const match of text.matchAll(patternCache)) {
    const bytes = Buffer.byteLength(match[0], "utf8");
    work += (MATCH_OVERHEAD_BYTES + bytes) * bytes;
  }
  return work;
}

// null means ABOVE THE WORK BUDGET, deliberately not measured — never zero,
// never an estimate. Callers omit the token fields rather than substitute a
// value. A returned number is the encoder's own count for the whole string:
// nothing is chunked, so it is exact.
export async function countTokens(text: string): Promise<number | null> {
  const work = await tokenWorkUnits(text);
  if (work === null || work > MAX_WORK_UNITS) return null;

  // `disallowedSpecial: []` counts `<|endoftext|>` and friends as ordinary
  // text instead of throwing. This is measurement, not a model call, and tool
  // output containing those literals is routine on a coding-agent path — this
  // repo's own specs contain them. Throwing would omit the fields and, worse,
  // record the row as a tokenizer failure.
  return (await loadEncoding()).encode(text, [], []).length;
}
