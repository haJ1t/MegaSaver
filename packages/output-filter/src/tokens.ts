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

const CHUNK_SIZE = 1000;

export async function countTokens(text: string): Promise<number> {
  const encoding = await loadEncoding();
  if (text.length <= CHUNK_SIZE) {
    return encoding.encode(text).length;
  }
  let total = 0;
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    total += encoding.encode(text.slice(i, i + CHUNK_SIZE)).length;
  }
  return total;
}
