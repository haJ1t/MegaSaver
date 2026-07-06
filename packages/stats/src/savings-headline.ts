import { tokensFromBytes } from "./honest-metrics.js";

// Representative Anthropic input rate (Sonnet-class), USD per million tokens.
// The saved tokens were compressed away and never sent, so no prompt-cache
// discount applies. The exact per-model price is the one modeled assumption —
// hence every headline carries isEstimate: true and the render layer labels it
// "(est.)".
export const INPUT_PRICE_PER_MTOK_USD = 3.0;

// One full context window = "a session's worth" of context. Using the full
// 200K window as the divisor UNDER-counts real sessions (a real session rarely
// fills 200K), which is the honest direction — we never overstate reclaim.
export const CONTEXT_WINDOW_TOKENS = 200_000;

export interface SavingsHeadlineTotals {
  bytesSavedTotal: number;
  sessionsCount: number;
  savingRatio: number;
}

export interface SavingsHeadline {
  tokensSaved: number;
  dollarsSaved: number;
  contextWindowsReclaimed: number;
  savingRatio: number;
  isEstimate: true;
}

export function computeSavingsHeadline(
  totals: SavingsHeadlineTotals,
  opts?: { inputPricePerMTok?: number },
): SavingsHeadline {
  const inputPricePerMTok = opts?.inputPricePerMTok ?? INPUT_PRICE_PER_MTOK_USD;
  const tokensSaved = tokensFromBytes(totals.bytesSavedTotal);
  return {
    tokensSaved,
    dollarsSaved: (tokensSaved / 1_000_000) * inputPricePerMTok,
    contextWindowsReclaimed: tokensSaved / CONTEXT_WINDOW_TOKENS,
    savingRatio: totals.savingRatio,
    isEstimate: true,
  };
}
