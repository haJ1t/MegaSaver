import { cosine } from "@megasaver/embeddings";
import type { CodeBlock } from "@megasaver/indexer";
import { rankBm25 } from "@megasaver/retrieval";
import { type CoChangeMap, coChangeStrength, parseNumstat } from "./cochange.js";
import type { ScoreFactors } from "./pack.js";
import { WEIGHTS } from "./weights.js";

export type ScoreInput = {
  task: string;
  blocks: readonly CodeBlock[];
  changedFiles?: readonly string[];
  failingTests?: readonly string[];
  memoryFiles?: readonly string[];
  staleFiles?: readonly string[];
  // Raw `git log --numstat` text. Parsed once (memoized on the string) into a
  // co-change map; absent/empty => co-change factor is 0 for every block.
  coChangeLog?: string;
  // Pre-computed embedding vectors (the async work — embedding the task + loading
  // the block-vector sidecar — happens at the boundary, NOT here, so the scorer
  // stays synchronous). Absent ⇒ embeddingRelevance is 0 for every block.
  taskVector?: Float32Array;
  blockVectors?: Map<string, Float32Array>;
};

// Parse-once cache: `git log --numstat` is large and the same text is handed to
// repeated scoreBlocks calls within a process. Memoize on the raw string so the
// O(commits²-per-commit) parse runs once. ponytail: single-entry memo is enough
// — the log is per-repo and stable for a process; widen to a Map if multi-repo
// scoring in one process ever matters.
let lastLog: string | undefined;
let lastMap: CoChangeMap | undefined;

function coChangeMapFor(raw: string | undefined): CoChangeMap | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw !== lastLog) {
    lastLog = raw;
    lastMap = parseNumstat(raw);
  }
  return lastMap;
}

export type ScoredCandidate = { block: CodeBlock; factors: ScoreFactors; score: number };

const NOISE_PATH_RE =
  /(^|\/)(dist|build|vendor|node_modules|coverage)\/|\.min\.|(^|[.\-/])lock\b|\.lock$/i;
// A block spanning >400 lines is almost always generated / a bundle / a giant
// data literal, not a unit an agent reasons about — penalize it as noise.
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

// Embedding relevance for one block: clamped cosine(taskVector, blockVector) in
// 0..1. Returns 0 when either vector is missing (graceful BM25-only fallback) or
// when cosine is negative (so it never fights the positive factors).
function embeddingRelevanceFor(
  blockId: string,
  taskVector: Float32Array | undefined,
  blockVectors: Map<string, Float32Array> | undefined,
): number {
  if (taskVector === undefined || blockVectors === undefined) return 0;
  const v = blockVectors.get(blockId);
  if (v === undefined) return 0;
  return Math.max(0, cosine(taskVector, v));
}

export function scoreBlocks(input: ScoreInput): ScoredCandidate[] {
  const changed = new Set(input.changedFiles ?? []);
  const failing = new Set(input.failingTests ?? []);
  const memory = new Set(input.memoryFiles ?? []);
  const stale = new Set(input.staleFiles ?? []);
  const semantic = semanticScores(input.task, input.blocks);
  const coChange = coChangeMapFor(input.coChangeLog);
  const changedFiles = input.changedFiles ?? [];

  const scored = input.blocks.map((block) => {
    const factors: ScoreFactors = {
      semanticRelevance: semantic.get(block.id) ?? 0,
      embeddingRelevance: embeddingRelevanceFor(block.id, input.taskVector, input.blockVectors),
      // dependencyRelevance is assigned during selection (closure pull-ins).
      dependencyRelevance: 0,
      coChangeRelevance:
        coChange === undefined ? 0 : coChangeStrength(coChange, block.filePath, changedFiles),
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
    WEIGHTS.embedding * factors.embeddingRelevance +
    WEIGHTS.dependency * factors.dependencyRelevance +
    WEIGHTS.coChange * factors.coChangeRelevance +
    WEIGHTS.testFailure * factors.testFailureRelevance +
    WEIGHTS.recentEdit * factors.recentEditRelevance +
    WEIGHTS.memory * factors.memoryRelevance +
    WEIGHTS.userMention * factors.userMentionRelevance -
    WEIGHTS.stale * factors.stalePenalty -
    WEIGHTS.noise * factors.noisePenalty
  );
}
