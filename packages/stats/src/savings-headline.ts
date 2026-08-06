import { tokensFromBytes } from "./honest-metrics.js";
import { MODEL_LIST_PRICES, inputPricePerMTok } from "./model-prices.js";

// Representative Anthropic input rate (Sonnet-class), USD per million tokens.
// The saved tokens were compressed away and never sent, so no prompt-cache
// discount applies. The exact per-model price is the one modeled assumption —
// hence every headline carries isEstimate: true and the render layer labels it
// "(est.)".
// DERIVED, not copied: reading the rate out of MODEL_LIST_PRICES means the
// headline $ and the `audit --honest` $ cannot quote two different prices, and
// the rate cannot travel without the capture date below. The literal value is
// still pinned by `packages/stats/test/savings-headline.test.ts` so a table
// edit trips a test instead of silently repricing what users see.
const DEFAULT_INPUT_RATE = inputPricePerMTok(MODEL_LIST_PRICES, undefined);
export const INPUT_PRICE_PER_MTOK_USD = DEFAULT_INPUT_RATE.usd;

// The date the rate above was read off the published pricing page. Rendered
// with the figure: a price with no capture date is an undated claim, and the
// dollar headline is the number the most users see.
export const INPUT_PRICE_CAPTURED_AT = MODEL_LIST_PRICES.capturedAt;

// One full context window = "a session's worth" of context. Using the full
// 200K window as the divisor UNDER-counts real sessions (a real session rarely
// fills 200K), which is the honest direction — we never overstate reclaim.
export const CONTEXT_WINDOW_TOKENS = 200_000;

// Single source of truth for the human-readable price footnote. The displayed
// "$N/M" is derived from the price argument, so it can never drift from the
// constant the way a hardcoded "$3/M" string literal would. Both the CLI audit
// line and the GUI tooltip render SAVINGS_FOOTNOTE, so they never disagree.
// capturedAt is REQUIRED, not defaulted: a caller passing its own rate would
// otherwise inherit this module's date and stamp the wrong provenance on it.
export function savingsFootnote(inputPricePerMTok: number, capturedAt: string): string {
  return `(est. at $${inputPricePerMTok}/M input, published list rate captured ${capturedAt}; saved tokens were never sent, so not cache-discounted.)`;
}

export const SAVINGS_FOOTNOTE = savingsFootnote(INPUT_PRICE_PER_MTOK_USD, INPUT_PRICE_CAPTURED_AT);

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
  // The signed net (gross minus expansion debits, W0/B3). Optional so legacy
  // callers keep working; absent means "no expansion data", which prices the
  // gross — the only honest reading a pre-B1 store supports.
  deltaBytesTotal?: number;
}

export interface SavingsHeadline {
  // The headline number: NET tokens (gross minus everything re-fetched back),
  // clamped at zero — a negative net is real but a negative "$ saved" reads
  // as noise. The UNCLAMPED fields below carry the loss: netTokensSigned goes
  // negative and tokensRefetched exceeds gross exactly when a window lost
  // more than it saved, so every breakdown renders the true
  // "X saved − Y re-fetched + overhead = Z net".
  tokensSaved: number;
  // Signed net, never clamped. Equal to tokensSaved when non-negative.
  netTokensSigned: number;
  grossTokensSaved: number;
  // grossTokensSaved − netTokensSigned (derived from the UNCLAMPED delta, so
  // it can exceed gross); "X saved − Y = Z net" is arithmetically exact in
  // the displayed token space. The negative-delta pool includes envelope
  // overhead, not only refetches — surfaces label it "re-fetched + overhead".
  tokensRefetched: number;
  dollarsSaved: number;
  contextWindowsReclaimed: number;
  savingRatio: number;
  isEstimate: true;
}

// Byte-based entry: the token-saver retains saved BYTES, so convert with the
// shared bytes/4 model before pricing. Used by the GUI home headline and any
// all-workspace aggregation. S4-1: the priced figure is the signed NET — the
// ledger already records expansion debits, and headlining the gross overstates
// savings on every session that ever expanded a chunk back.
export function computeSavingsHeadline(
  totals: SavingsHeadlineTotals,
  opts?: { inputPricePerMTok?: number },
): SavingsHeadline {
  const grossTokens = tokensFromBytes(totals.bytesSavedTotal);
  // Signed BEFORE clamping: the clamp is a display rule for the priced $ only.
  // Deriving tokensRefetched from a pre-clamped net capped it at gross, which
  // erased exactly the windows that re-fetched more than they saved.
  const netTokensSigned = tokensFromBytes(totals.deltaBytesTotal ?? totals.bytesSavedTotal);
  return {
    ...savingsHeadlineFromTokens(Math.max(0, netTokensSigned), totals.savingRatio, opts),
    netTokensSigned,
    grossTokensSaved: grossTokens,
    tokensRefetched: grossTokens - netTokensSigned,
  };
}

// Token-based entry: the audit summary already yields a saved-TOKEN count
// (tokensBefore - tokensAfter), so it prices directly without a byte round-trip.
// Both entries share the one price/window model so the CLI and GUI never drift.
// A bare token count carries no expansion split, so gross == net here.
export function savingsHeadlineFromTokens(
  tokensSaved: number,
  savingRatio: number,
  opts?: { inputPricePerMTok?: number },
): SavingsHeadline {
  const inputPricePerMTok = opts?.inputPricePerMTok ?? INPUT_PRICE_PER_MTOK_USD;
  return {
    tokensSaved,
    netTokensSigned: tokensSaved,
    grossTokensSaved: tokensSaved,
    tokensRefetched: 0,
    dollarsSaved: (tokensSaved / 1_000_000) * inputPricePerMTok,
    contextWindowsReclaimed: tokensSaved / CONTEXT_WINDOW_TOKENS,
    savingRatio,
    isEstimate: true,
  };
}
