import type { CodeBlock } from "@megasaver/indexer";
import { blockTypeSchema } from "@megasaver/indexer";
import { z } from "zod";
import { type ScoreInput, type ScoredCandidate, scoreBlocks } from "./score.js";
import { type ExclusionReason, selectImpact, selectPack } from "./select.js";

// The eight LAMR relevance factors (positive) and penalties (kept positive,
// subtracted in finalScore). Every factor is recorded per block so `explain`
// can show why a block was kept or cut.
export const scoreFactorsSchema = z
  .object({
    semanticRelevance: z.number(),
    dependencyRelevance: z.number(),
    coChangeRelevance: z.number(),
    testFailureRelevance: z.number(),
    recentEditRelevance: z.number(),
    memoryRelevance: z.number(),
    userMentionRelevance: z.number(),
    stalePenalty: z.number(),
    noisePenalty: z.number(),
  })
  .strict();

export type ScoreFactors = z.infer<typeof scoreFactorsSchema>;

export const scoredBlockSchema = z
  .object({
    blockId: z.string(),
    filePath: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    blockType: blockTypeSchema,
    name: z.string().optional(),
    score: z.number(),
    reasons: z.array(z.string().min(1)),
    factors: scoreFactorsSchema,
  })
  .strict();

export type ScoredBlock = z.infer<typeof scoredBlockSchema>;

export const contextPackSchema = z
  .object({
    task: z.string(),
    included: z.array(scoredBlockSchema),
    excluded: z.array(scoredBlockSchema),
    budget: z
      .object({
        maxTokens: z.number().nullable(),
        usedTokens: z.number().int().nonnegative(),
        blocksConsidered: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ContextPack = z.infer<typeof contextPackSchema>;

export type PruneRequest = ScoreInput & { limit?: number; maxTokens?: number };

// Human reasons derived from a block's factors, strongest first. Always returns
// at least one entry (schema requires non-empty, meaningful strings).
function inclusionReasons(candidate: ScoredCandidate): string[] {
  const f = candidate.factors;
  const reasons: string[] = [];
  if (f.userMentionRelevance > 0) reasons.push("named in task");
  if (f.testFailureRelevance > 0) reasons.push("failing test evidence");
  if (f.dependencyRelevance > 0) reasons.push("dependency support");
  if (f.coChangeRelevance > 0) reasons.push("co-changes with edit site");
  if (f.memoryRelevance > 0) reasons.push("cited by project memory");
  if (f.recentEditRelevance > 0) reasons.push("recently changed");
  if (f.semanticRelevance >= 0.3) reasons.push("direct semantic evidence");
  if (reasons.length === 0) reasons.push("weak semantic match");
  return reasons;
}

function exclusionReason(reason: ExclusionReason): string {
  return reason === "budget" ? "excluded: cut by token/limit budget" : "excluded: low relevance";
}

function toScoredBlock(candidate: ScoredCandidate, reasons: string[]): ScoredBlock {
  const { block } = candidate;
  return {
    blockId: block.id,
    filePath: block.filePath,
    startLine: block.startLine,
    endLine: block.endLine,
    blockType: block.blockType,
    ...(block.name !== undefined ? { name: block.name } : {}),
    score: candidate.score,
    reasons,
    factors: candidate.factors,
  };
}

// Score → select → assemble. The orchestrator the CLI/MCP call.
export function buildContextPack(request: PruneRequest): ContextPack {
  const candidates = scoreBlocks(request);
  const selection = selectPack(candidates, {
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
  });
  return {
    task: request.task,
    included: selection.included.map((c) => toScoredBlock(c, inclusionReasons(c))),
    excluded: selection.excluded.map((e) =>
      toScoredBlock(e.candidate, [exclusionReason(e.reason)]),
    ),
    budget: {
      maxTokens: request.maxTokens ?? null,
      usedTokens: selection.usedTokens,
      blocksConsidered: selection.blocksConsidered,
    },
  };
}

export type ImpactRequest = {
  symbol: string;
  blocks: readonly CodeBlock[];
  limit?: number;
  maxTokens?: number;
};

// Reverse-BFS blast radius: the symbol + its transitive callers, packaged in the
// same ContextPack shape as buildContextPack so the MCP tool returns one type.
// Scored with the symbol as the task so the root reads as "named in task" and
// pulled-in callers as "dependency support". `task` echoes the queried symbol.
export function buildImpactPack(request: ImpactRequest): ContextPack {
  const candidates = scoreBlocks({ task: request.symbol, blocks: request.blocks });
  const selection = selectImpact(candidates, request.symbol, {
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
  });
  return {
    task: request.symbol,
    included: selection.included.map((c) => toScoredBlock(c, inclusionReasons(c))),
    excluded: selection.excluded.map((e) =>
      toScoredBlock(e.candidate, [exclusionReason(e.reason)]),
    ),
    budget: {
      maxTokens: request.maxTokens ?? null,
      usedTokens: selection.usedTokens,
      blocksConsidered: selection.blocksConsidered,
    },
  };
}
