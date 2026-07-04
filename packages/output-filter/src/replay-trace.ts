import { readFileSync } from "node:fs";
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
  // Union of the memory ids that ranking-boosted the SELECTED chunks (per
  // output). Optional/additive — absent when no selected chunk matched a memory
  // term, so legacy traces and seam-off runs parse unchanged.
  rankedByMemoryIds?: string[];
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
  // Union the per-chunk matched memory ids across the SELECTED chunks only
  // (omitted chunks did not drive the output). Deduped, insertion-ordered.
  const rankedByMemoryIds: string[] = [];
  for (const c of input.selected) {
    for (const id of c.matchedMemoryIds ?? []) {
      if (!rankedByMemoryIds.includes(id)) rankedByMemoryIds.push(id);
    }
  }
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
    ...(rankedByMemoryIds.length > 0 ? { rankedByMemoryIds } : {}),
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
  compressor: z.enum(["vitest", "typescript", "diff", "structured", "prose", "generic"]),
  engineRanking: z.boolean(),
  rawTokens: z.number(),
  returnedTokens: z.number(),
  candidates: z.array(chunkRefSchema),
  selected: z.array(chunkRefSchema),
  omitted: z.array(chunkRefSchema),
  rankedByMemoryIds: z.array(z.string()).optional(),
});

// Full replay trace (spec §12.2). References the content-store chunkSetId for
// raw expansion rather than duplicating output, so v1.4 can replay ranking
// offline over the stored chunks.
// A seam fact, not a ranking fact: whether the registry seam redacted secrets
// from this output and how many. Top-level (parallel to chunkSetId) so the
// decision-trace reader surfaces it without the cross-store evidence join.
const redactionSchema = z.object({
  redacted: z.boolean(),
  secretsRedacted: z.number(),
});

export const replayTraceSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  task: z.string().optional(),
  toolName: z.string(),
  query: z.string().optional(),
  chunkSetId: z.string().optional(),
  redaction: redactionSchema.optional(),
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
  redaction?: { redacted: boolean; secretsRedacted: number };
};

export function finalizeReplayTrace(ranking: RankingTrace, meta: ReplayTraceMeta): ReplayTrace {
  return {
    sessionId: meta.sessionId,
    projectId: meta.projectId,
    toolName: meta.toolName,
    ...(meta.task !== undefined ? { task: meta.task } : {}),
    ...(meta.query !== undefined ? { query: meta.query } : {}),
    ...(meta.chunkSetId !== undefined ? { chunkSetId: meta.chunkSetId } : {}),
    ...(meta.redaction !== undefined ? { redaction: meta.redaction } : {}),
    ranking,
    createdAt: meta.createdAt,
  };
}

// JSONL reader for `mega audit seam`. Tolerant by design: a corrupt or
// schema-drifted line is skipped (never thrown) and a missing file means no
// traces yet — observability must not fail the report over one bad record.
export function readReplayTraces(path: string): ReplayTrace[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const traces: ReplayTrace[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = replayTraceSchema.safeParse(json);
    if (parsed.success) traces.push(parsed.data);
  }
  return traces;
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
