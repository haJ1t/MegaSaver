import type { CodeBlock } from "@megasaver/indexer";
import type { ScoredCandidate } from "./score.js";
import { MIN_RELEVANCE_SCORE } from "./weights.js";

export const DEFAULT_LIMIT = 8;
// Blocks carry no source text, so token cost is estimated from the line span.
// (chars/4 is unavailable without the source; a precise tokenizer is a later
// upgrade — see Phase 3 spec §4.)
const TOKENS_PER_LINE = 12;

export type ExclusionReason = "irrelevant" | "budget";
export type ExcludedCandidate = { candidate: ScoredCandidate; reason: ExclusionReason };
export type Selection = {
  included: ScoredCandidate[];
  excluded: ExcludedCandidate[];
  usedTokens: number;
  blocksConsidered: number;
};
export type SelectOptions = { limit?: number; maxTokens?: number };

export function estimateSpanTokens(startLine: number, endLine: number): number {
  return Math.max(1, (endLine - startLine + 1) * TOKENS_PER_LINE);
}

export function estimateBlockTokens(block: CodeBlock): number {
  return estimateSpanTokens(block.startLine, block.endLine);
}

// A block the pack MUST contain: an explicitly named symbol/file or a
// failing-test block. These are never dropped for budget or limit (the safety
// invariant — a forced overflow is reported via usedTokens, never hidden).
function isForced(candidate: ScoredCandidate): boolean {
  return candidate.factors.userMentionRelevance > 0 || candidate.factors.testFailureRelevance > 0;
}

// `candidates` arrive pre-sorted by finalScore desc (scoreBlocks). Select forced
// blocks first, then top relevant blocks under limit+budget, then pull in
// dependency-closure helpers (resolved from `calls` within the indexed set).
export function selectPack(
  candidates: readonly ScoredCandidate[],
  options: SelectOptions,
): Selection {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxTokens = options.maxTokens;
  const tokensOf = new Map(candidates.map((c) => [c.block.id, estimateBlockTokens(c.block)]));

  const included: ScoredCandidate[] = [];
  const includedIds = new Set<string>();
  let usedTokens = 0;

  const add = (candidate: ScoredCandidate, force: boolean): boolean => {
    if (includedIds.has(candidate.block.id)) return true;
    const cost = tokensOf.get(candidate.block.id) ?? 1;
    if (!force) {
      if (included.length >= limit) return false;
      if (maxTokens !== undefined && usedTokens + cost > maxTokens) return false;
    }
    included.push(candidate);
    includedIds.add(candidate.block.id);
    usedTokens += cost;
    return true;
  };

  for (const candidate of candidates) {
    if (isForced(candidate)) add(candidate, true);
  }
  for (const candidate of candidates) {
    if (!includedIds.has(candidate.block.id) && candidate.score >= MIN_RELEVANCE_SCORE) {
      add(candidate, false);
    }
  }

  // Dependency closure: a `calls` target resolved to another block's name/export
  // is pulled in (even at low relevance) so the pack is self-contained.
  const byName = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    if (candidate.block.name) byName.set(candidate.block.name, candidate);
    for (const exported of candidate.block.exports) byName.set(exported, candidate);
  }
  for (const candidate of [...included]) {
    for (const call of candidate.block.calls) {
      const target = byName.get(call);
      if (target && !includedIds.has(target.block.id) && add(target, false)) {
        target.factors.dependencyRelevance = 1;
      }
    }
  }

  const excluded: ExcludedCandidate[] = [];
  for (const candidate of candidates) {
    if (includedIds.has(candidate.block.id)) continue;
    excluded.push({
      candidate,
      reason: candidate.score >= MIN_RELEVANCE_SCORE ? "budget" : "irrelevant",
    });
  }

  return { included, excluded, usedTokens, blocksConsidered: candidates.length };
}
