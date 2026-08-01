import {
  type AuditSummary,
  type OverlaySessionTokenSaverStats,
  SAVINGS_FOOTNOTE,
  type SavingsHeadline,
  formatDollarsSaved,
  savingsHeadlineFromTokens,
} from "@megasaver/core";
import type { SavedValueEstimate } from "@megasaver/stats";

// U+2212 minus so a loss renders as "−1000", never the hyphen-minus that some
// fonts render ambiguously next to the ≈/− arithmetic already on these lines.
function signedNum(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

// S4-1 net-first: headline the SIGNED net — a window that re-fetched more
// than it saved must read negative here, not clamp to a flattering zero (only
// the priced $ clamps). Gross and re-fetched + overhead stay visible as the
// breakdown; the % is the GROSS savingRatio and is labeled as such so it is
// never mistaken for a net rate. A pre-B1 summary carries no deltaBytesTotal
// — no expansion data exists, so only the gross line is honest there.
function savedLineOf(summary: OverlaySessionTokenSaverStats, savingPct: number): string {
  if (summary.deltaBytesTotal === undefined) {
    return `  saved:   ${summary.bytesSavedTotal} bytes (${savingPct}%)`;
  }
  const net = summary.deltaBytesTotal;
  const refetched = summary.bytesSavedTotal - net;
  return `  saved:   ${signedNum(net)} bytes net (${summary.bytesSavedTotal} B saved − ${refetched} B re-fetched + overhead, ${savingPct}% gross)`;
}

export function formatOverlaySaverCard(
  summary: OverlaySessionTokenSaverStats,
  workspaceKey: string,
): string[] {
  const savingPct = Math.round(summary.savingRatio * 100);
  return [
    "live token-saver session (overlay stats)",
    `  workspace: ${workspaceKey}`,
    `  events:  ${summary.eventsTotal}`,
    `  bytes:   ${summary.rawBytesTotal} -> ${summary.returnedBytesTotal}`,
    savedLineOf(summary, savingPct),
    `  chunks stored:    ${summary.chunksStoredTotal}`,
    `  secrets redacted: ${summary.secretsRedactedTotal}`,
    `  updated: ${summary.updatedAt}`,
  ];
}

export function formatAuditCards(summary: AuditSummary): string[] {
  return [
    `window: ${summary.window}  (events: ${summary.eventsTotal})`,
    "Context pruning:",
    `  files:  ${summary.filesIncluded}/${summary.filesConsidered} included`,
    `  blocks: ${summary.blocksIncluded}/${summary.blocksConsidered} included`,
    `  tokens: ${summary.tokensBefore} -> ${summary.tokensAfter}`,
    "FORGE:",
    `  rules applied: ${summary.rulesApplied}`,
    `  repeated failures avoided: ${summary.repeatedFailuresAvoided}`,
    `  retry cost saved: ${summary.retryCostSaved} tokens`,
    "Memory:",
    `  memories retrieved: ${summary.memoriesRetrieved}`,
    "Tools:",
    `  tool schemas reduced: ${summary.toolSchemasReduced}`,
    `would've been ${summary.tokensBefore} tokens, was ${summary.tokensAfter}, ${summary.percentageSaved}% saved`,
    ...formatSavingsHeadlineLines(auditSavingsHeadline(summary)),
  ];
}

// The audit summary already holds a saved-TOKEN count, so price it directly
// (no byte round-trip). percentageSaved is an integer 0-100 -> pass the ratio.
export function auditSavingsHeadline(summary: AuditSummary): SavingsHeadline {
  return savingsHeadlineFromTokens(summary.tokensSaved, summary.percentageSaved / 100);
}

// Zero GROSS must not flex a fake "$0.00 saved!" — render an honest line. A
// non-positive NET with a non-zero gross is different: savings happened and
// were spent back (and then some) on expansions, so the breakdown renders
// with the SIGNED net and the loss stays visible.
export function formatSavingsHeadlineLines(headline: SavingsHeadline): string[] {
  if (headline.grossTokensSaved === 0) {
    return ["No savings recorded in this window yet."];
  }
  const saved =
    headline.tokensRefetched === 0
      ? `Saved ≈${headline.tokensSaved} tokens`
      : `Saved ≈${headline.tokensSaved} tokens net (≈${headline.grossTokensSaved} saved − ${headline.tokensRefetched} re-fetched + overhead = ${signedNum(headline.netTokensSigned)} net)`;
  return [
    `${saved} ≈ ${formatDollarsSaved(headline.dollarsSaved)} (est.) · ≈${headline.contextWindowsReclaimed.toFixed(1)} sessions' worth of context (200K each).`,
    SAVINGS_FOOTNOTE,
  ];
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

// Tokens first, dollars subordinate. The dollar line may not be emitted without
// its date and its upper-bound caveat, so no caller can render a bare figure.
export function renderSavedValueLines(estimate: SavedValueEstimate): string[] {
  const lines = [
    `Tokens saved (net, measured):  ${estimate.netTokensMeasured.toLocaleString("en-US")}`,
    `Estimated value:               ~$${estimate.estimatedUsd.toFixed(2)}  (est.)`,
    `  published list input rates, captured ${estimate.capturedAt}`,
    "  upper bound — ignores prompt-cache discounts on tokens that would have",
    "  been re-read rather than re-sent",
  ];
  if (estimate.unknownModelTokenShare > 0) {
    lines.push(`  unknown-model share: ${pct(estimate.unknownModelTokenShare)}`);
  }
  if (estimate.measuredCoverage < 1) {
    lines.push(
      `measured coverage: ${pct(estimate.measuredCoverage)} of rows (rest pre-measurement, read as bytes/4)`,
    );
  }
  return lines;
}
