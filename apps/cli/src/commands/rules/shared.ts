import type { ProjectRule } from "@megasaver/core";
import { projectRuleIdSchema } from "@megasaver/shared";

export { projectRuleIdSchema };

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatRuleLine(r: Pick<ProjectRule, "id" | "severity" | "title">): string {
  return `${r.id}  ${r.severity.padEnd(8, " ")}  ${r.title}`;
}

export function formatRankedRuleLine(ranked: {
  rule: Pick<ProjectRule, "id" | "severity" | "title">;
  score: number;
  reason: string;
}): string {
  return `${ranked.rule.id}  ${ranked.rule.severity.padEnd(8, " ")}  score=${ranked.score}  ${ranked.rule.title}  (${ranked.reason})`;
}
