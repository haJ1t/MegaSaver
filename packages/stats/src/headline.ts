// Browser-safe subpath: the pure savings-headline math + constants only, with
// no node:fs store code. The GUI client imports the price/window const from
// here so it lives ONCE, shared with the CLI (which uses the package root).
export {
  INPUT_PRICE_PER_MTOK_USD,
  CONTEXT_WINDOW_TOKENS,
  SAVINGS_FOOTNOTE,
  savingsFootnote,
  formatDollarsSaved,
  computeSavingsHeadline,
  savingsHeadlineFromTokens,
  type SavingsHeadline,
  type SavingsHeadlineTotals,
} from "./savings-headline.js";

export { renderSavingsCardSvg } from "./savings-card.js";
