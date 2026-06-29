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
