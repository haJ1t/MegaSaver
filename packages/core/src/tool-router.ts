import { rankBm25 } from "@megasaver/retrieval";
import type { ToolCategory } from "./tool-definition.js";
import type { ToolDefinition } from "./tool-definition.js";

export type ToolRouteResult = {
  allowedTools: ToolDefinition[];
  blockedTools: ToolDefinition[];
  reason: string;
};

// SECURITY-CRITICAL set: tools in these categories never enter allowedTools
// from a plain task route, regardless of text relevance. deploy mutates
// running/production infrastructure; database mutates persistent stores; both
// have catastrophic, often irreversible blast radii, so a BM25 text match is
// never treated as consent. `dangerous` is the explicit destructive label and
// is blocked by category as a redundant guard against a mis-set `risk`.
const BLOCKED_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "dangerous",
  "deploy",
  "database",
]);

// A tool is blocked iff its risk is dangerous OR its category is in the blocked
// set. Total: every tool is classified by this single boolean, gate runs before
// relevance (see routeToolsForTask).
export function isBlockedTool(tool: ToolDefinition): boolean {
  return tool.risk === "dangerous" || BLOCKED_CATEGORIES.has(tool.category);
}

const BLOCKED_SUFFIX = "blocked as dangerous/deploy/database";

// Deterministic recommender. Stage 1 (security gate): split into blocked vs
// candidate by isBlockedTool — blocked tools can NEVER reach allowedTools.
// Stage 2 (relevance): among candidates only, no/blank query => all candidates
// allowed; else BM25 over name+description+keywords, score>0 => allowed
// (descending score, id tiebreak), score<=0 => omitted from BOTH lists
// (irrelevant, not forbidden). No LLM. Stable order.
export function routeToolsForTask(
  tools: readonly ToolDefinition[],
  query: string | undefined,
): ToolRouteResult {
  const blockedTools = tools.filter(isBlockedTool).sort((a, b) => a.id.localeCompare(b.id));
  const candidates = tools.filter((tool) => !isBlockedTool(tool));

  const text = query?.trim();
  const hasText = text !== undefined && text.length > 0;

  if (!hasText) {
    const allowedTools = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
    return {
      allowedTools,
      blockedTools,
      reason: `no task filter — ${allowedTools.length} safe tool(s) allowed; ${blockedTools.length} ${BLOCKED_SUFFIX}`,
    };
  }

  const scoreById = new Map<string, number>();
  if (candidates.length > 0) {
    const documents = candidates.map((tool) => ({
      id: tool.id,
      text: `${tool.name} ${tool.description} ${tool.keywords.join(" ")}`,
    }));
    for (const hit of rankBm25({ query: text, documents, topN: candidates.length })) {
      if (hit.score > 0) scoreById.set(hit.id, hit.score);
    }
  }

  const allowedTools = candidates
    .filter((tool) => scoreById.has(tool.id))
    .sort(
      (a, b) => (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0) || a.id.localeCompare(b.id),
    );

  const notRelevant = candidates.length - allowedTools.length;
  const head =
    allowedTools.length > 0
      ? `${allowedTools.length} tool(s) matched '${text}'`
      : `no tools matched '${text}'`;
  return {
    allowedTools,
    blockedTools,
    reason: `${head}; ${blockedTools.length} ${BLOCKED_SUFFIX}; ${notRelevant} not relevant`,
  };
}
