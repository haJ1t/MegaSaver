import { z } from "zod";
import type { AuditEvent } from "./audit-event.js";

export const auditWindowSchema = z.enum(["session", "week", "all"]);
export type AuditWindow = z.infer<typeof auditWindowSchema>;

export function resolveAuditWindow(
  window: AuditWindow | undefined,
  hasSession: boolean,
): AuditWindow {
  return window ?? (hasSession ? "session" : "all");
}

export const auditSummarySchema = z
  .object({
    window: auditWindowSchema,
    eventsTotal: z.number().int().nonnegative(),
    filesConsidered: z.number().int().nonnegative(),
    filesIncluded: z.number().int().nonnegative(),
    filesExcluded: z.number().int().nonnegative(),
    blocksConsidered: z.number().int().nonnegative(),
    blocksIncluded: z.number().int().nonnegative(),
    blocksExcluded: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
    tokensSaved: z.number().int().nonnegative(),
    percentageSaved: z.number().min(0).max(100),
    repeatedFailuresAvoided: z.number().int().nonnegative(),
    rulesApplied: z.number().int().nonnegative(),
    retryCostSaved: z.number().int().nonnegative(),
    memoriesRetrieved: z.number().int().nonnegative(),
    toolSchemasReduced: z.number().int().nonnegative(),
  })
  .strict();

export type AuditSummary = z.infer<typeof auditSummarySchema>;

export type SummarizeAuditOptions = { window: AuditWindow; now: () => string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function withinWindow(event: AuditEvent, opts: SummarizeAuditOptions): boolean {
  if (opts.window !== "week") return true;
  const cutoff = Date.parse(opts.now()) - WEEK_MS;
  return Date.parse(event.createdAt) >= cutoff;
}

export function summarizeAudit(
  events: readonly AuditEvent[],
  opts: SummarizeAuditOptions,
): AuditSummary {
  const acc = {
    eventsTotal: 0,
    filesConsidered: 0,
    filesIncluded: 0,
    filesExcluded: 0,
    blocksConsidered: 0,
    blocksIncluded: 0,
    blocksExcluded: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    repeatedFailuresAvoided: 0,
    rulesApplied: 0,
    retryCostSaved: 0,
    memoriesRetrieved: 0,
    toolSchemasReduced: 0,
  };

  for (const event of events) {
    if (!withinWindow(event, opts)) continue;
    acc.eventsTotal += 1;
    switch (event.kind) {
      case "context_pack_built":
        acc.filesConsidered += event.filesConsidered;
        acc.filesIncluded += event.filesIncluded;
        acc.filesExcluded += event.filesExcluded;
        acc.blocksConsidered += event.blocksConsidered;
        acc.blocksIncluded += event.blocksIncluded;
        acc.blocksExcluded += event.blocksExcluded;
        acc.tokensBefore += event.tokensBefore;
        acc.tokensAfter += event.tokensAfter;
        break;
      case "rule_applied":
        acc.rulesApplied += 1;
        break;
      case "failure_avoided":
        acc.repeatedFailuresAvoided += 1;
        acc.retryCostSaved += event.retryTokensAvoided;
        break;
      case "memory_retrieved":
        acc.memoriesRetrieved += 1;
        break;
      case "tool_route":
        acc.toolSchemasReduced += event.toolSchemasReduced;
        break;
    }
  }

  const tokensSaved = Math.max(0, acc.tokensBefore - acc.tokensAfter);
  const percentageSaved =
    acc.tokensBefore > 0 ? Math.round((tokensSaved / acc.tokensBefore) * 100) : 0;

  return auditSummarySchema.parse({
    window: opts.window,
    ...acc,
    tokensSaved,
    percentageSaved,
  });
}
