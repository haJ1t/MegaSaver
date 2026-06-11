import { blockTypeSchema } from "@megasaver/indexer";
import { z } from "zod";

// The eight LAMR relevance factors (positive) and penalties (kept positive,
// subtracted in finalScore). Every factor is recorded per block so `explain`
// can show why a block was kept or cut.
export const scoreFactorsSchema = z
  .object({
    semanticRelevance: z.number(),
    dependencyRelevance: z.number(),
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
