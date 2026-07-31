import {
  type AuditSummary,
  type OverlaySessionTokenSaverStats,
  SAVINGS_FOOTNOTE,
  type SavingsHeadline,
  formatDollarsSaved,
  savingsHeadlineFromTokens,
} from "@megasaver/core";

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
