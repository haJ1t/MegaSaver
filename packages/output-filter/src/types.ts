import { redact } from "@megasaver/policy";
import { modeToBudget, riskLevelSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { type Classification, classifyOutput, isConfidentClassification } from "./classify.js";
import { type CompressorName, compressByCategory } from "./compress/index.js";
import { dedupe } from "./dedupe.js";
import { OutputFilterError } from "./errors.js";
import { effectiveBudget, fitBudget } from "./fit.js";
import { collapseRepeatedLines, normalize } from "./normalize.js";
import { chunkByFormat } from "./parsers/index.js";
import {
  type EngineScore,
  type RankFeatures,
  type RankedChunk,
  applyEngineRanking,
  engineRankingFromEnv,
  scoreChunk,
} from "./rank.js";
import { summarize } from "./summarize.js";
import {
  type FilterDecision,
  HARD_WRAP_THRESHOLD_TOKENS,
  PASSTHROUGH_THRESHOLD_TOKENS,
  estimateTokens,
} from "./tokens.js";

export const filterOutputInputSchema = z
  .object({
    raw: z.string(),
    intent: z.string().min(1).optional(),
    mode: tokenSaverModeSchema,
    maxReturnedBytes: z.number().int().positive().optional(),
    passthroughThresholdTokens: z.number().int().positive().optional(),
    hardWrapThresholdTokens: z.number().int().positive().optional(),
    sessionHints: z
      .object({
        title: z.string().nullable().optional(),
        recentFiles: z.array(z.string()).readonly().optional(),
        recentMemory: z.array(z.string()).readonly().optional(),
        projectConventions: z.array(z.string()).readonly().optional(),
        recentFailures: z.array(z.string()).readonly().optional(),
        risk: riskLevelSchema.optional(),
      })
      .optional(),
    engineRanking: z.boolean().optional(),
    source: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("file"), path: z.string() }),
        z.object({
          kind: z.literal("command"),
          command: z.string(),
          args: z.array(z.string()).readonly(),
        }),
        z.object({ kind: z.literal("grep"), query: z.string() }),
        z.object({ kind: z.literal("fetch"), url: z.string() }),
      ])
      .optional(),
  })
  .strict();

export type FilterOutputInput = z.infer<typeof filterOutputInputSchema>;

export type OutputExcerpt = {
  text: string;
  startLine: number;
  endLine: number;
  score: number;
  features: RankFeatures;
  engine?: EngineScore;
};

export type FilterOutputResult = {
  summary: string;
  excerpts: readonly OutputExcerpt[];
  classification: Classification;
  decision: FilterDecision;
  compressor: CompressorName;
  rawBytes: number;
  returnedBytes: number;
  rawTokens: number;
  returnedTokens: number;
  bytesSaved: number;
  savingRatio: number;
  chunkSetId?: string;
  warnings?: readonly string[];
};

function excerptOf(chunk: RankedChunk): OutputExcerpt {
  const base = {
    text: chunk.text,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    score: chunk.score,
    features: chunk.features,
  };
  return chunk.engine !== undefined ? { ...base, engine: chunk.engine } : base;
}

export function filterOutput(input: FilterOutputInput): FilterOutputResult {
  const parsed = filterOutputInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OutputFilterError("validation_failed", parsed.error.message);
  }
  const { raw, intent, mode, maxReturnedBytes, sessionHints, source } = parsed.data;

  const warnings: string[] = [];

  const { redacted, count } = redact(raw);
  if (count > 0) warnings.push(`redacted ${count} secret(s) before processing`);

  const normalized = collapseRepeatedLines(normalize(redacted));
  // Classify after ANSI strip, before compressor dispatch (§10.2).
  const command =
    source?.kind === "command" ? `${source.command} ${source.args.join(" ")}`.trim() : undefined;
  const classification = classifyOutput({ command, text: normalized });

  const rawBytes = Buffer.byteLength(raw, "utf8");
  const rawTokens = estimateTokens(raw);
  const passthroughThreshold =
    parsed.data.passthroughThresholdTokens ?? PASSTHROUGH_THRESHOLD_TOKENS;
  const hardWrapThreshold = parsed.data.hardWrapThresholdTokens ?? HARD_WRAP_THRESHOLD_TOKENS;

  // §11: small outputs skip compression (a wrapper would cost more than
  // it saves). Only the compressed band runs a specialized compressor
  // and fits to budget; passthrough/light keep all chunks (ranked, not
  // truncated) so no real signal is dropped.
  const decision: FilterDecision =
    rawTokens < passthroughThreshold
      ? "passthrough"
      : rawTokens < hardWrapThreshold
        ? "light"
        : "compressed";

  let compressor: CompressorName = "generic";
  let textForChunks = normalized;
  if (decision === "compressed" && isConfidentClassification(classification)) {
    const compressed = compressByCategory(classification.category, normalized);
    compressor = compressed.compressor;
    textForChunks = compressed.text;
  }

  const chunks = chunkByFormat(textForChunks);
  const scored = chunks.map((c) => scoreChunk(intent, c, sessionHints));
  // §8: engine-aware re-ranking is behind a flag and reuses the base
  // relevance — no second scorer. Off by default.
  const engineEnabled = parsed.data.engineRanking ?? engineRankingFromEnv();
  const ranked = engineEnabled ? applyEngineRanking(scored, sessionHints) : scored;
  const deduped = dedupe(ranked);

  const ordered = [...deduped].sort((a, b) => b.score - a.score);
  const budget = effectiveBudget(maxReturnedBytes, modeToBudget(mode));
  const kept = decision === "compressed" ? fitBudget(deduped, budget) : ordered;
  const droppedCount = deduped.length - kept.length;
  const summary =
    decision === "passthrough"
      ? `passthrough: ${rawTokens} tokens below compression threshold`
      : summarize(mode, kept, droppedCount);

  const excerpts = kept.map(excerptOf);

  const returnedBytes =
    Buffer.byteLength(summary, "utf8") +
    excerpts.reduce((sum, e) => sum + Buffer.byteLength(e.text, "utf8"), 0);
  const returnedTokens =
    estimateTokens(summary) + excerpts.reduce((sum, e) => sum + estimateTokens(e.text), 0);
  const bytesSaved = Math.max(0, rawBytes - returnedBytes);
  const savingRatio = rawBytes === 0 ? 0 : bytesSaved / rawBytes;

  const result: FilterOutputResult = {
    summary,
    excerpts,
    classification,
    decision,
    compressor,
    rawBytes,
    returnedBytes,
    rawTokens,
    returnedTokens,
    bytesSaved,
    savingRatio,
  };
  if (warnings.length > 0) return { ...result, warnings };
  return result;
}
