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

// js-tiktoken's encode is quadratic in the length of an unbroken, whitespace-free
// RUN — not in total size. Measured 2026-08-01: run 2,000 -> 142 ms,
// 8,000 -> 2,277 ms, 32,000 -> 36 s, 50,000 -> 91 s, while 64 KB with a space
// every 100 chars is 227 ms and 56 KB of real TypeScript is 7 ms.
//
// So chunking is applied ONLY when such a run exists. Chunking splits BPE tokens
// at the cut and overcounts by ~0.2-0.5% on real text, always upward — a bias a
// field named rawTokens must not carry when it can be avoided.
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
