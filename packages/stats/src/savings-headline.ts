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

// Single source of truth for the human-readable price footnote. The displayed
// "$N/M" is derived from the price argument, so it can never drift from the
// constant the way a hardcoded "$3/M" string literal would. Both the CLI audit
// line and the GUI tooltip render SAVINGS_FOOTNOTE, so they never disagree.
export function savingsFootnote(inputPricePerMTok: number): string {
  return `(est. at $${inputPricePerMTok}/M input; saved tokens were never sent, so not cache-discounted.)`;
}

export const SAVINGS_FOOTNOTE = savingsFootnote(INPUT_PRICE_PER_MTOK_USD);

// Display-only formatter for the public shared $. Floors the cents so a
// half-cent (e.g. raw $37.035) shows "$37.03", never rounding up — this
// feature under-counts on purpose (the reclaim count and the 200K divisor
// already do), so the headline $ must not overstate. The numeric
// dollarsSaved field stays lossless; only this display formatter floors.
export function formatDollarsSaved(dollarsSaved: number): string {
  return `$${(Math.floor(dollarsSaved * 100) / 100).toFixed(2)}`;
}

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

// Byte-based entry: the token-saver retains saved BYTES, so convert with the
// shared bytes/4 model before pricing. Used by the GUI home headline and any
// all-workspace aggregation.
export function computeSavingsHeadline(
  totals: SavingsHeadlineTotals,
  opts?: { inputPricePerMTok?: number },
): SavingsHeadline {
  return savingsHeadlineFromTokens(
    tokensFromBytes(totals.bytesSavedTotal),
    totals.savingRatio,
    opts,
  );
}

// Token-based entry: the audit summary already yields a saved-TOKEN count
// (tokensBefore - tokensAfter), so it prices directly without a byte round-trip.
// Both entries share the one price/window model so the CLI and GUI never drift.
export function savingsHeadlineFromTokens(
  tokensSaved: number,
  savingRatio: number,
  opts?: { inputPricePerMTok?: number },
): SavingsHeadline {
  const inputPricePerMTok = opts?.inputPricePerMTok ?? INPUT_PRICE_PER_MTOK_USD;
  return {
    tokensSaved,
    dollarsSaved: (tokensSaved / 1_000_000) * inputPricePerMTok,
    contextWindowsReclaimed: tokensSaved / CONTEXT_WINDOW_TOKENS,
    savingRatio,
    isEstimate: true,
  };
}
