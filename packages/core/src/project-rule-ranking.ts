import { rankBm25 } from "@megasaver/retrieval";
import { z } from "zod";
import type { ProjectRule, RuleSeverity } from "./project-rule.js";

const DEFAULT_LIMIT = 20;
// A file/appliesTo overlap is stronger evidence than a pure text hit, so weight
// each matched path above a typical single-term BM25 score.
const PATH_MATCH_WEIGHT = 2;

export const applicableRuleQuerySchema = z
  .object({
    task: z.string().optional(),
    files: z.array(z.string().min(1)).default([]),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

export type ApplicableRuleQuery = { task?: string; files?: readonly string[]; limit?: number };
export type RankedRule = { rule: ProjectRule; score: number; reason: string };

const SEVERITY_RANK: Record<RuleSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function rankApplicableRules(
  rules: readonly ProjectRule[],
  query: ApplicableRuleQuery,
): RankedRule[] {
  const q = applicableRuleQuerySchema.parse(query);
  const text = q.task?.trim();
  const hasText = text !== undefined && text.length > 0;
  const hasFilter = hasText || q.files.length > 0;

  if (!hasFilter) {
    return [...rules]
      .sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id),
      )
      .slice(0, q.limit)
      .map((rule) => ({ rule, score: 0, reason: "no task filter" }));
  }

  const textScore = new Map<string, number>();
  if (hasText) {
    const documents = rules.map((r) => ({
      id: r.id,
      text: `${r.title} ${r.rule} ${r.evidence.join(" ")}`,
    }));
    for (const hit of rankBm25({ query: text as string, documents, topN: rules.length })) {
      if (hit.score > 0) textScore.set(hit.id, hit.score);
    }
  }

  const scored: RankedRule[] = [];
  for (const rule of rules) {
    const matchedPaths: string[] = [];
    for (const file of q.files) {
      for (const glob of rule.appliesTo) {
        if (glob.length > 0 && (file.startsWith(glob) || glob.startsWith(file))) {
          matchedPaths.push(file);
          break;
        }
      }
    }
    const score = matchedPaths.length * PATH_MATCH_WEIGHT + (textScore.get(rule.id) ?? 0);
    if (score <= 0) continue;
    const reasons: string[] = [];
    if (matchedPaths.length > 0) reasons.push(`applies to ${matchedPaths.join(", ")}`);
    if ((textScore.get(rule.id) ?? 0) > 0) reasons.push("matches task text");
    scored.push({ rule, score, reason: reasons.join("; ") });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        SEVERITY_RANK[a.rule.severity] - SEVERITY_RANK[b.rule.severity] ||
        a.rule.id.localeCompare(b.rule.id),
    )
    .slice(0, q.limit);
}
