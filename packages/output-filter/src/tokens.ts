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

type TiktokenEncoding = { encode(text: string): number[] };

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
    (m) => m.getEncoding("cl100k_base") as TiktokenEncoding,
  );
  return encodingPromise;
}

// js-tiktoken's encode blows up on long runs of HIGHLY REPETITIVE characters,
// not on long runs as such. Measured 2026-08-01, whole-string encode:
//
//   "X".repeat(n)          n=2,000 -> 142 ms · 8,000 -> 2.3 s · 50,000 -> 91 s
//   60 KB repeating hex    9 ms          (unbroken, but varied)
//   64 KB space-free JSON  33 ms         (unbroken, but varied)
//   56 KB TypeScript       7 ms
//
// An earlier version of this comment blamed "quadratic backtracking on
// whitespace-free runs". That is wrong: 60 KB of unbroken alphanumerics encodes
// in 9 ms. Only the degenerate repeated-character shape is slow.
//
// `longestRun` is therefore a deliberately CONSERVATIVE proxy: cheap to compute
// (one O(n) scan) and it cannot miss the pathological case, at the cost of also
// chunking some safe inputs. Chunking splits BPE tokens at the cut and
// overcounts slightly — measured 0.00% on code and prose (never chunked),
// 0.05% on base64, 0.20% on space-free JSON.
//
// The bias direction matters and it is NOT benign: the overcount is always
// upward, and a compressed output's small `returnedText` usually stays under
// the guard while the large `raw` does not, so `rawTokens - returnedTokens`
// INFLATES the reported saving rather than understating it. Bounded at 0.20%
// on the worst measured shape, against the +19.3% JSON error of the bytes/4
// estimator this replaced — ~100x closer, but biased in the flattering
// direction, which is why the guard exists to keep normal text off this path.
export const MAX_SAFE_RUN = 2000;
const CHUNK_SIZE = 1000;

function longestRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // space, tab, LF, CR
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      if (current > longest) longest = current;
      current = 0;
    } else {
      current++;
    }
  }
  return current > longest ? current : longest;
}

export async function countTokens(text: string): Promise<number> {
  const encoding = await loadEncoding();
  if (longestRun(text) <= MAX_SAFE_RUN) {
    return encoding.encode(text).length;
  }
  let total = 0;
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    total += encoding.encode(text.slice(i, i + CHUNK_SIZE)).length;
  }
  return total;
}
