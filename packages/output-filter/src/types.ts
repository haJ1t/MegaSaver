import { redact } from "@megasaver/policy";
import { modeToBudget, riskLevelSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { dedupe } from "./dedupe.js";
import { OutputFilterError } from "./errors.js";
import { effectiveBudget, fitBudget } from "./fit.js";
import { collapseRepeatedLines, normalize } from "./normalize.js";
import { chunkByFormat } from "./parsers/index.js";
import { type RankFeatures, type RankedChunk, scoreChunk } from "./rank.js";
import { summarize } from "./summarize.js";

export const filterOutputInputSchema = z
  .object({
    raw: z.string(),
    intent: z.string().min(1).optional(),
    mode: tokenSaverModeSchema,
    maxReturnedBytes: z.number().int().positive().optional(),
    sessionHints: z
      .object({
        title: z.string().nullable().optional(),
        recentFiles: z.array(z.string()).readonly().optional(),
        recentMemory: z.array(z.string()).readonly().optional(),
        projectConventions: z.array(z.string()).readonly().optional(),
        risk: riskLevelSchema.optional(),
      })
      .optional(),
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
};

export type FilterOutputResult = {
  summary: string;
  excerpts: readonly OutputExcerpt[];
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  savingRatio: number;
  chunkSetId?: string;
  warnings?: readonly string[];
};

function excerptOf(chunk: RankedChunk): OutputExcerpt {
  return {
    text: chunk.text,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    score: chunk.score,
    features: chunk.features,
  };
}

export function filterOutput(input: FilterOutputInput): FilterOutputResult {
  const parsed = filterOutputInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OutputFilterError("validation_failed", parsed.error.message);
  }
  const { raw, intent, mode, maxReturnedBytes, sessionHints } = parsed.data;

  const warnings: string[] = [];

  const { redacted, count } = redact(raw);
  if (count > 0) warnings.push(`redacted ${count} secret(s) before processing`);

  const normalized = collapseRepeatedLines(normalize(redacted));
  const chunks = chunkByFormat(normalized);
  const ranked = chunks.map((c) => scoreChunk(intent, c, sessionHints));
  const deduped = dedupe(ranked);

  const budget = effectiveBudget(maxReturnedBytes, modeToBudget(mode));
  const kept = fitBudget(deduped, budget);
  const droppedCount = deduped.length - kept.length;
  const summary = summarize(mode, kept, droppedCount);

  const excerpts = kept.map(excerptOf);

  const rawBytes = Buffer.byteLength(raw, "utf8");
  const returnedBytes =
    Buffer.byteLength(summary, "utf8") +
    excerpts.reduce((sum, e) => sum + Buffer.byteLength(e.text, "utf8"), 0);
  const bytesSaved = Math.max(0, rawBytes - returnedBytes);
  const savingRatio = rawBytes === 0 ? 0 : bytesSaved / rawBytes;

  const result: FilterOutputResult = {
    summary,
    excerpts,
    rawBytes,
    returnedBytes,
    bytesSaved,
    savingRatio,
  };
  if (warnings.length > 0) return { ...result, warnings };
  return result;
}
