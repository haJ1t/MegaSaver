import {
  type AuditSummary,
  type OverlaySessionTokenSaverStats,
  SAVINGS_FOOTNOTE,
  type SavingsHeadline,
  savingsHeadlineFromTokens,
} from "@megasaver/core";

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
    `  saved:   ${summary.bytesSavedTotal} bytes (${savingPct}%)`,
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

// Zero savings must not flex a fake "$0.00 saved!" — render an honest line.
export function formatSavingsHeadlineLines(headline: SavingsHeadline): string[] {
  if (headline.tokensSaved === 0) {
    return ["No savings recorded in this window yet."];
  }
  return [
    `Saved ≈${headline.tokensSaved} tokens ≈ $${headline.dollarsSaved.toFixed(2)} (est.) · ≈${headline.contextWindowsReclaimed.toFixed(1)} sessions' worth of context (200K each).`,
    SAVINGS_FOOTNOTE,
  ];
}
