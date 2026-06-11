import type { CodeBlock } from "@megasaver/indexer";
import { rankBm25 } from "@megasaver/retrieval";
import type { ScoreFactors } from "./pack.js";
import { WEIGHTS } from "./weights.js";

export type ScoreInput = {
  task: string;
  blocks: readonly CodeBlock[];
  changedFiles?: readonly string[];
  failingTests?: readonly string[];
  memoryFiles?: readonly string[];
  staleFiles?: readonly string[];
};

export type ScoredCandidate = { block: CodeBlock; factors: ScoreFactors; score: number };

const NOISE_PATH_RE =
  /(^|\/)(dist|build|vendor|node_modules|coverage)\/|\.min\.|(^|[.\-/])lock\b|\.lock$/i;
const HUGE_SPAN_LINES = 400;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function basenameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function isNoise(block: CodeBlock): boolean {
  return NOISE_PATH_RE.test(block.filePath) || block.endLine - block.startLine > HUGE_SPAN_LINES;
}

function isUserMentioned(task: string, block: CodeBlock): boolean {
  const lower = task.toLowerCase();
  if (block.name && new RegExp(`\\b${escapeRegExp(block.name.toLowerCase())}\\b`).test(lower)) {
    return true;
  }
  return (
    lower.includes(block.filePath.toLowerCase()) ||
    lower.includes(basenameOf(block.filePath).toLowerCase())
  );
}

// Semantic relevance: BM25 of the task over each block's doc (name + keywords +
// path + type), normalized to 0..1 by the top score so weights stay comparable.
function semanticScores(task: string, blocks: readonly CodeBlock[]): Map<string, number> {
  const documents = blocks.map((block) => ({
    id: block.id,
    text: `${block.name ?? ""} ${block.keywords.join(" ")} ${block.filePath} ${block.blockType}`,
  }));
  const ranked = rankBm25({ query: task, documents, topN: Math.max(blocks.length, 1) });
  const max = ranked.reduce((acc, hit) => Math.max(acc, hit.score), 0);
  const scores = new Map<string, number>();
  if (max > 0) {
    for (const hit of ranked) scores.set(hit.id, hit.score / max);
  }
  return scores;
}

export function scoreBlocks(input: ScoreInput): ScoredCandidate[] {
  const changed = new Set(input.changedFiles ?? []);
  const failing = new Set(input.failingTests ?? []);
  const memory = new Set(input.memoryFiles ?? []);
  const stale = new Set(input.staleFiles ?? []);
  const semantic = semanticScores(input.task, input.blocks);

  const scored = input.blocks.map((block) => {
    const factors: ScoreFactors = {
      semanticRelevance: semantic.get(block.id) ?? 0,
      // dependencyRelevance is assigned during selection (closure pull-ins).
      dependencyRelevance: 0,
      testFailureRelevance: failing.has(block.filePath) ? 1 : 0,
      recentEditRelevance: changed.has(block.filePath) ? 1 : 0,
      memoryRelevance: memory.has(block.filePath) ? 1 : 0,
      userMentionRelevance: isUserMentioned(input.task, block) ? 1 : 0,
      stalePenalty: stale.has(block.filePath) ? 1 : 0,
      noisePenalty: isNoise(block) ? 1 : 0,
    };
    return { block, factors, score: finalScore(factors) };
  });

  return scored.sort((a, b) =>
    b.score === a.score ? a.block.id.localeCompare(b.block.id) : b.score - a.score,
  );
}

export function finalScore(factors: ScoreFactors): number {
  return (
    WEIGHTS.semantic * factors.semanticRelevance +
    WEIGHTS.dependency * factors.dependencyRelevance +
    WEIGHTS.testFailure * factors.testFailureRelevance +
    WEIGHTS.recentEdit * factors.recentEditRelevance +
    WEIGHTS.memory * factors.memoryRelevance +
    WEIGHTS.userMention * factors.userMentionRelevance -
    WEIGHTS.stale * factors.stalePenalty -
    WEIGHTS.noise * factors.noisePenalty
  );
}
