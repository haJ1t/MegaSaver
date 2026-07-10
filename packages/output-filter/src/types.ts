import { redactWithFindings } from "@megasaver/policy";
import { modeToBudget, riskLevelSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { chunkByLines } from "./chunk.js";
import { type Classification, classifyOutput, isConfidentClassification } from "./classify.js";
import { type CompressorName, compressByCategory } from "./compress/index.js";
import { dedupe } from "./dedupe.js";
import { OutputFilterError } from "./errors.js";
import { effectiveBudget, fitBudget } from "./fit.js";
import { collapseRepeatedLines, collapseSimilar, normalize } from "./normalize.js";
import { chunkByFormatWithMeta } from "./parsers/index.js";
import { outlineFile } from "./parsers/outline.js";
import {
  type EngineScore,
  type RankFeatures,
  type RankedChunk,
  applyEngineRanking,
  engineRankingFromEnv,
  scoreChunk,
} from "./rank.js";
import { type RankingTrace, buildRankingTrace } from "./replay-trace.js";
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
        memoryTerms: z
          .array(z.object({ id: z.string(), text: z.string() }))
          .readonly()
          .optional(),
        risk: riskLevelSchema.optional(),
      })
      .optional(),
    engineRanking: z.boolean().optional(),
    recordTrace: z.boolean().optional(),
    outline: z.boolean().optional(),
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

export type OutlineBody = {
  startLine: number;
  endLine: number;
  text: string;
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
  // Total line count of the text the excerpts index into (post-collapse /
  // post-compression space, NOT raw). Lets a renderer place gap markers in
  // the same space as excerpt line numbers instead of mixing in raw lines.
  chunkedLineCount?: number;
  trace?: RankingTrace;
  chunkSetId?: string;
  chunks?: readonly OutlineBody[];
  warnings?: readonly string[];
  unchanged?: { priorChunkSetId: string };
  deduped?: { suppressed: number; priorChunkSetIds: string[] };
  firewall?: {
    findings: ReadonlyArray<{ name: string; count: number }>;
    observed: ReadonlyArray<{ name: string; count: number }>;
  };
};

// Generic line grouping for the no-blind fallback; matches the default
// used by the generic chunker.
const GENERIC_FALLBACK_LINES_PER_CHUNK = 40;

// Outline mode only pays off when the skeleton is meaningfully smaller than
// the raw file. On tiny or dense/minified files the signature skeleton can
// equal or exceed raw bytes, so below this fraction of raw we keep the
// outline; at or above it we fall through to a normal read — an opt-in
// outline must never return a payload larger than a plain read.
const OUTLINE_MAX_SKELETON_RATIO = 0.9;

function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  // Back off any UTF-8 continuation byte (0b10xxxxxx) so we never split a
  // code point. At most three iterations.
  while (end > 0) {
    const byte = buf[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    end -= 1;
  }
  return buf.toString("utf8", 0, end);
}

function truncateChunkToBytes(chunk: RankedChunk, maxBytes: number): RankedChunk {
  const text = truncateToBytes(chunk.text, maxBytes);
  if (text === chunk.text) return chunk;
  // Keep the reported line span consistent with the truncated body.
  const endLine = chunk.startLine + text.split("\n").length - 1;
  return { ...chunk, text, endLine };
}

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

// Diagnostic/error-family classifications whose chunks are each distinct
// evidence (one per file/line/code) and must NOT be simhash-deduped. Only the
// families that exist in OutputCategory take effect; the rest are listed so the
// intent survives when classify.ts grows eslint/pytest/etc. vitest/test is
// deliberately excluded — its compressor already collapses duplicate failures.
const DIAGNOSTIC_CATEGORIES = new Set<string>([
  "typescript",
  "eslint",
  "stacktrace",
  "pytest",
  "go_test",
  "cargo_test",
]);

export async function filterOutput(input: FilterOutputInput): Promise<FilterOutputResult> {
  const parsed = filterOutputInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OutputFilterError("validation_failed", parsed.error.message);
  }
  const { raw, intent, mode, maxReturnedBytes, sessionHints, source } = parsed.data;

  const warnings: string[] = [];

  const redaction = redactWithFindings(raw);
  const { redacted } = redaction;
  if (redaction.count > 0) {
    warnings.push(`redacted ${redaction.count} secret(s) before processing`);
  }
  const firewall =
    redaction.findings.length > 0 || redaction.observed.length > 0
      ? { findings: redaction.findings, observed: redaction.observed }
      : undefined;

  const normalized = collapseSimilar(collapseRepeatedLines(normalize(redacted)));
  // Classify after ANSI strip, before compressor dispatch (§10.2).
  const command =
    source?.kind === "command" ? `${source.command} ${source.args.join(" ")}`.trim() : undefined;
  const path = source?.kind === "file" ? source.path : undefined;
  const classification = classifyOutput({ command, path, text: normalized });

  const rawBytes = Buffer.byteLength(raw, "utf8");

  // Narrow `source` to the file variant directly so `source.path` is typed.
  if (parsed.data.outline === true && source?.kind === "file") {
    const outline = await outlineFile(normalized, source.path);
    const returnedBytes = outline === null ? 0 : Buffer.byteLength(outline.skeleton, "utf8");
    // Size floor: only take the outline branch when the skeleton actually
    // saves context. Otherwise fall through to the normal rank/fit pipeline
    // (still lossless — it persists its own chunks).
    if (outline !== null && returnedBytes < rawBytes * OUTLINE_MAX_SKELETON_RATIO) {
      const normalizedLineCount = normalized.replace(/\n$/, "").split("\n").length;
      const skeletonChunk = {
        text: outline.skeleton,
        startLine: 1,
        endLine: normalizedLineCount,
      };
      const excerpt = excerptOf(scoreChunk(intent, skeletonChunk, sessionHints));
      const rawTokens = estimateTokens(raw);
      const returnedTokens = estimateTokens(outline.skeleton);
      const bytesSaved = Math.max(0, rawBytes - returnedBytes);
      const base: FilterOutputResult = {
        // ponytail: tool name hardcoded; lift to a constant when the CLI surface stabilises.
        summary: "outline mode: expand bodies via mega_fetch_chunk",
        excerpts: [excerpt],
        chunkedLineCount: normalizedLineCount,
        chunks: outline.chunks.map((c) => ({
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
        })),
        classification,
        decision: "outline",
        compressor: "generic",
        rawBytes,
        returnedBytes,
        rawTokens,
        returnedTokens,
        bytesSaved,
        savingRatio: rawBytes === 0 ? 0 : bytesSaved / rawBytes,
        ...(firewall !== undefined ? { firewall } : {}),
      };
      return warnings.length > 0 ? { ...base, warnings } : base;
    }
  }

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
  const isFileSource = source?.kind === "file";
  // Source-code file reads route to semantic AST chunking, not a category
  // compressor. The structured (JSON) compressor is exempt: a *.json read is
  // exactly its target, and semantic chunking ignores non-code files anyway.
  const compressorEligible =
    decision === "compressed" &&
    (!isFileSource || classification.category === "structured") &&
    isConfidentClassification(classification);
  if (compressorEligible) {
    const compressed = compressByCategory(classification.category, normalized, intent);
    compressor = compressed.compressor;
    textForChunks = compressed.text;
  }

  const {
    chunks,
    semantic: usedSemantic,
    diagnostic: usedDiagnostic,
  } = await chunkByFormatWithMeta(textForChunks, source);
  const scored = chunks.map((c) => scoreChunk(intent, c, sessionHints));
  // §8: engine-aware re-ranking is behind a flag and reuses the base
  // relevance — no second scorer. Off by default.
  const engineEnabled = parsed.data.engineRanking ?? engineRankingFromEnv();
  const ranked = engineEnabled ? applyEngineRanking(scored, sessionHints) : scored;
  // Semantic chunks are an exhaustive partition of one file — no true
  // duplicates exist, so dedupe would only erase distinct declarations.
  // Diagnostic-class outputs share that property: every `error TSxxxx` line
  // is distinct evidence (a different file/line/code), but they are near
  // enough for simhash to collapse, so dedupe would erase real diagnostics.
  // vitest/test is exempt from THIS exemption — its compressor already folds
  // duplicate failures, so its chunks stay deduped.
  // usedDiagnostic covers parsers (eslint/pytest/go/cargo/stacktrace) whose
  // outputs classify as generic_shell/unknown — the category set can't catch
  // them, so the parser reports the per-diagnostic shape directly.
  const skipDedupe =
    usedSemantic || usedDiagnostic || DIAGNOSTIC_CATEGORIES.has(classification.category);
  const deduped = skipDedupe ? ranked : dedupe(ranked);

  const ordered = [...deduped].sort((a, b) => b.score - a.score);
  const budget = effectiveBudget(maxReturnedBytes, modeToBudget(mode));
  let kept = decision === "compressed" ? fitBudget(deduped, budget) : ordered;
  let omitted = deduped.filter((c) => !kept.includes(c));
  let droppedCount = deduped.length - kept.length;

  // No-blind floor (mission: never strip what the model needs to decide).
  // The compressed path can yield zero excerpts two ways: a specialized
  // compressor empties its input (e.g. misclassified output whose pattern
  // never matches), or every chunk exceeds the byte budget. Re-chunk the
  // normalized (uncompressed) output generically and keep the top-ranked
  // content within budget — truncating the single top chunk when even one
  // chunk overflows — so the model is never handed an empty result.
  if (kept.length === 0 && normalized.trim() !== "") {
    const scoredFallback = chunkByLines(normalized, GENERIC_FALLBACK_LINES_PER_CHUNK).map((c) =>
      scoreChunk(intent, c, sessionHints),
    );
    const fallback = engineEnabled
      ? applyEngineRanking(scoredFallback, sessionHints)
      : scoredFallback;
    const fallbackOrdered = [...fallback].sort((a, b) => b.score - a.score);
    const fitted = fitBudget(fallback, budget);
    const top = fallbackOrdered[0];
    if (fitted.length > 0) {
      kept = fitted;
      omitted = fallbackOrdered.filter((c) => !kept.includes(c));
      droppedCount = fallbackOrdered.length - fitted.length;
    } else if (top !== undefined) {
      // Nothing fit — keep the top-ranked chunk truncated to budget. The
      // truncated chunk is a new object, so derive omitted from the rest
      // explicitly rather than by reference identity.
      kept = [truncateChunkToBytes(top, budget)];
      omitted = fallbackOrdered.slice(1);
      droppedCount = fallbackOrdered.length - 1;
    }
    if (kept.length > 0) {
      warnings.push("specialized compression produced no excerpts; returned generic excerpt");
    }
  }
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

  const trace: RankingTrace | undefined = parsed.data.recordTrace
    ? buildRankingTrace({
        classification,
        decision,
        compressor,
        engineRanking: engineEnabled,
        rawTokens,
        returnedTokens,
        selected: kept,
        omitted,
      })
    : undefined;

  // Max endLine over the FINAL chunk universe (kept ∪ omitted) — space-agnostic,
  // always matching the excerpts whether the path used compressed, normalized,
  // or the no-blind fallback text.
  const chunkedLineCount = Math.max(
    0,
    ...kept.map((c) => c.endLine),
    ...omitted.map((c) => c.endLine),
  );

  const result: FilterOutputResult = {
    summary,
    excerpts,
    chunkedLineCount,
    classification,
    decision,
    compressor,
    rawBytes,
    returnedBytes,
    rawTokens,
    returnedTokens,
    bytesSaved,
    savingRatio,
    ...(trace !== undefined ? { trace } : {}),
    ...(firewall !== undefined ? { firewall } : {}),
  };
  if (warnings.length > 0) return { ...result, warnings };
  return result;
}
