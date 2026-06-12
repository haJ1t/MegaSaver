import type { AuditSummary } from "@megasaver/core";

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
