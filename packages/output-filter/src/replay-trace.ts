import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Classification, outputCategorySchema } from "./classify.js";
import type { CompressorName } from "./compress/index.js";
import type { EngineScore, RankedChunk } from "./rank.js";
import type { FilterDecision } from "./tokens.js";

// A chunk reference for the trace — line range + scores only, never the raw
// text (privacy §12.3; the raw lives in the content store, referenced by id).
export type ChunkRef = {
  startLine: number;
  endLine: number;
  score: number;
  engine?: EngineScore;
};

// The ranking-layer portion of the replay trace — everything filterOutput
// knows. Wrapped with session/tool/content-store metadata by finalizeReplayTrace.
export type RankingTrace = {
  classification: Classification;
  decision: FilterDecision;
  compressor: CompressorName;
  engineRanking: boolean;
  rawTokens: number;
  returnedTokens: number;
  candidates: ChunkRef[];
  selected: ChunkRef[];
  omitted: ChunkRef[];
};

function toChunkRef(c: RankedChunk): ChunkRef {
  const ref = { startLine: c.startLine, endLine: c.endLine, score: c.score };
  return c.engine !== undefined ? { ...ref, engine: c.engine } : ref;
}

export function buildRankingTrace(input: {
  classification: Classification;
  decision: FilterDecision;
  compressor: CompressorName;
  engineRanking: boolean;
  rawTokens: number;
  returnedTokens: number;
  selected: readonly RankedChunk[];
  omitted: readonly RankedChunk[];
}): RankingTrace {
  const selected = input.selected.map(toChunkRef);
  const omitted = input.omitted.map(toChunkRef);
  return {
    classification: input.classification,
    decision: input.decision,
    compressor: input.compressor,
    engineRanking: input.engineRanking,
    rawTokens: input.rawTokens,
    returnedTokens: input.returnedTokens,
    candidates: [...selected, ...omitted],
    selected,
    omitted,
  };
}

const engineScoreSchema = z.object({
  baseRelevance: z.number(),
  memoryBoost: z.number(),
  failureHistoryBoost: z.number(),
  finalScore: z.number(),
});

const chunkRefSchema = z.object({
  startLine: z.number(),
  endLine: z.number(),
  score: z.number(),
  engine: engineScoreSchema.optional(),
});

const rankingTraceSchema = z.object({
  classification: z.object({ category: outputCategorySchema, confidence: z.number() }),
  decision: z.enum(["passthrough", "light", "compressed", "unchanged-marker", "outline"]),
  compressor: z.enum(["vitest", "typescript", "diff", "structured", "generic"]),
  engineRanking: z.boolean(),
  rawTokens: z.number(),
  returnedTokens: z.number(),
  candidates: z.array(chunkRefSchema),
  selected: z.array(chunkRefSchema),
  omitted: z.array(chunkRefSchema),
});

// Full replay trace (spec §12.2). References the content-store chunkSetId for
// raw expansion rather than duplicating output, so v1.4 can replay ranking
// offline over the stored chunks.
export const replayTraceSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  task: z.string().optional(),
  toolName: z.string(),
  query: z.string().optional(),
  chunkSetId: z.string().optional(),
  ranking: rankingTraceSchema,
  createdAt: z.string(),
});

export type ReplayTrace = z.infer<typeof replayTraceSchema>;

export type ReplayTraceMeta = {
  sessionId: string;
  projectId: string;
  toolName: string;
  createdAt: string;
  task?: string;
  query?: string;
  chunkSetId?: string;
};

export function finalizeReplayTrace(ranking: RankingTrace, meta: ReplayTraceMeta): ReplayTrace {
  return {
    sessionId: meta.sessionId,
    projectId: meta.projectId,
    toolName: meta.toolName,
    ...(meta.task !== undefined ? { task: meta.task } : {}),
    ...(meta.query !== undefined ? { query: meta.query } : {}),
    ...(meta.chunkSetId !== undefined ? { chunkSetId: meta.chunkSetId } : {}),
    ranking,
    createdAt: meta.createdAt,
  };
}

// Best-effort append. Like the Claude Code hook logger, a replay trace must
// never block or fail the response it describes.
export async function writeReplayTrace(dir: string, trace: ReplayTrace): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "replay-traces.jsonl"), `${JSON.stringify(trace)}\n`, "utf8");
  } catch {
    // swallow — tracing is observability, not correctness
  }
}
