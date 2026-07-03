import type { AuditSummary, OverlaySessionTokenSaverStats } from "@megasaver/core";

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
  ];
}
