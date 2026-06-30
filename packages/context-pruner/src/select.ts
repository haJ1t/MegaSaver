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

// A block's own FQN "<filePath>#<name>" — the key resolvedCalls/resolvedCalledBy
// edges point at (WS2). Only blocks with a name participate.
function fqnOf(block: CodeBlock): string | undefined {
  return block.name === undefined ? undefined : `${block.filePath}#${block.name}`;
}

// The bare name in an FQN "<module>#<name>" (or "#<name>" for a local/unresolved
// call). Used for per-edge name fallback.
function nameFromFqn(fqn: string): string {
  return fqn.slice(fqn.indexOf("#") + 1);
}

// Resolve one FQN edge to a block: prefer the precise byFqn match; if it misses
// (an unresolved "#name" local call, a namespace-member call, or a renamed
// target a reused block still points at), fall back to the bare name via byName
// — so a resolved edge never has LESS reach than the name-based edge it replaced.
function resolveEdge(
  fqn: string,
  byFqn: Map<string, ScoredCandidate>,
  byName: Map<string, ScoredCandidate>,
): ScoredCandidate | undefined {
  return byFqn.get(fqn) ?? byName.get(nameFromFqn(fqn));
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

  // Resolve a name/export to a block. First writer wins — candidates are
  // score-sorted, so a collision resolves to the highest-scoring same-named
  // block (deterministic; names can legitimately collide across files).
  const byName = new Map<string, ScoredCandidate>();
  // FQN → block, for precise resolvedCalls traversal (WS2).
  const byFqn = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    if (candidate.block.name && !byName.has(candidate.block.name)) {
      byName.set(candidate.block.name, candidate);
    }
    for (const exported of candidate.block.exports) {
      if (!byName.has(exported)) byName.set(exported, candidate);
    }
    const fqn = fqnOf(candidate.block);
    if (fqn && !byFqn.has(fqn)) byFqn.set(fqn, candidate);
  }

  // Forward callees of a block: when resolvedCalls is present, resolve each edge
  // precisely by FQN (so a call hits the actual imported definition, not a
  // same-named block elsewhere) with a per-edge name fallback for the ones that
  // don't resolve; else walk name-based calls.
  const calleesOf = (candidate: ScoredCandidate): ScoredCandidate[] => {
    const resolved = candidate.block.resolvedCalls;
    if (resolved !== undefined) {
      return resolved
        .map((fqn) => resolveEdge(fqn, byFqn, byName))
        .filter((c): c is ScoredCandidate => c !== undefined);
    }
    return candidate.block.calls
      .map((name) => byName.get(name))
      .filter((c): c is ScoredCandidate => c !== undefined);
  };

  // Transitive dependency closure (BFS over callees): A→B→C all land in the
  // pack so it is self-contained. The visited/includedIds guard bounds the
  // walk; budget/limit still apply via add(), so closure stops at the budget.
  const queue: ScoredCandidate[] = [...included];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const target of calleesOf(current)) {
      if (!includedIds.has(target.block.id) && add(target, false)) {
        target.factors.dependencyRelevance = 1;
        queue.push(target);
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

export type ImpactSelectOptions = { limit?: number; maxTokens?: number };

// Reverse closure (blast radius): seed from the edited symbol's block(s), then
// BFS over `calledBy` to gather every transitive caller — the blocks a change to
// `symbol` could break. Mirrors selectPack's forward `calls` walk (~line 86) but
// inverted. The root is force-included (always present); callers fill under the
// budget. Callers cut by budget land in `excluded` (reason "budget"), never
// silently dropped — the closure is exhaustive within budget. An unknown symbol
// yields an empty selection (no root, no walk).
export function selectImpact(
  candidates: readonly ScoredCandidate[],
  symbol: string,
  options: ImpactSelectOptions,
): Selection {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxTokens = options.maxTokens;
  const tokensOf = new Map(candidates.map((c) => [c.block.id, estimateBlockTokens(c.block)]));

  // Name → block, first writer wins (candidates are id-stable here, no scoring).
  const byName = new Map<string, ScoredCandidate>();
  // FQN → block, for precise resolvedCalledBy traversal (WS2).
  const byFqn = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    if (candidate.block.name && !byName.has(candidate.block.name)) {
      byName.set(candidate.block.name, candidate);
    }
    for (const exported of candidate.block.exports) {
      if (!byName.has(exported)) byName.set(exported, candidate);
    }
    const fqn = fqnOf(candidate.block);
    if (fqn && !byFqn.has(fqn)) byFqn.set(fqn, candidate);
  }

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

  const root = byName.get(symbol);
  if (root === undefined) {
    return { included: [], excluded: [], usedTokens: 0, blocksConsidered: candidates.length };
  }
  add(root, true);

  // The reverse callers of a block: when resolvedCalledBy is present, resolve
  // each edge precisely by FQN (so two same-named functions in different files
  // don't pull in each other's callers) with a per-edge name fallback for the
  // ones that don't resolve; else walk name-based calledBy.
  const callersOf = (candidate: ScoredCandidate): ScoredCandidate[] => {
    const resolved = candidate.block.resolvedCalledBy;
    if (resolved !== undefined) {
      return resolved
        .map((fqn) => resolveEdge(fqn, byFqn, byName))
        .filter((c): c is ScoredCandidate => c !== undefined);
    }
    return candidate.block.calledBy
      .map((name) => byName.get(name))
      .filter((c): c is ScoredCandidate => c !== undefined);
  };

  // BFS over callers: a caller is a block affected by changing `current`. A
  // caller that does not fit the budget is recorded once (reason "budget") but
  // STILL walked, so callers reachable only through it are not silently dropped —
  // the blast radius is exhaustive within budget. The `reached` set bounds the
  // walk. Only blocks reached by the reverse walk appear in excluded — blocks
  // outside the blast radius are simply not part of it.
  const excluded: ExcludedCandidate[] = [];
  const reached = new Set<string>([root.block.id]);
  const queue: ScoredCandidate[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const target of callersOf(current)) {
      if (reached.has(target.block.id)) continue;
      reached.add(target.block.id);
      if (add(target, false)) {
        target.factors.dependencyRelevance = 1;
      } else {
        excluded.push({ candidate: target, reason: "budget" });
      }
      queue.push(target);
    }
  }

  return { included, excluded, usedTokens, blocksConsidered: candidates.length };
}
