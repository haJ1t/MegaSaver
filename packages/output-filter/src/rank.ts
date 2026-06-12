import type { RankFeatureName } from "./rank-features.js";

export type RankFeatures = Record<RankFeatureName, number>;

// Engine-aware ranking explanation (Proxy Mode v1.2 §8). All fields are
// normalized to [0,1]; finalScore is the weighted combination. Present only
// when engine ranking is enabled — it is the ranking explanation and the data
// the v1.4 replay trace records.
export type EngineScore = {
  baseRelevance: number;
  memoryBoost: number;
  failureHistoryBoost: number;
  finalScore: number;
};

export type RankedChunk = {
  text: string;
  startLine: number;
  endLine: number;
  score: number;
  features: RankFeatures;
  engine?: EngineScore;
};

export type SessionHints = {
  title?: string | null | undefined;
  recentFiles?: readonly string[] | undefined;
  recentMemory?: readonly string[] | undefined;
  projectConventions?: readonly string[] | undefined;
  // Signatures of prior failures (test names, error codes, …) for the
  // failure-history boost. Plumbed by the caller; the scorer only consumes it.
  recentFailures?: readonly string[] | undefined;
};

export type Chunk = {
  text: string;
  startLine: number;
  endLine: number;
};

// Lowercase failure words, case-insensitive so FAILED/Failure/ERROR all hit.
// `panic(ked)?` also catches Rust's "panicked at ...", which a bare \bpanic\b
// missed (no word boundary before "ked").
const ERROR = /\berror\b|\bfailed\b|\bfailure\b|\bexception\b|\bpanic(ked)?\b/i;
// CamelCase exception names (ZeroDivisionError, AssertionError, TypeError, …).
// Case-SENSITIVE on purpose: requiring a leading [A-Z] and the literal `Error`
// suffix targets real exception identifiers without re-matching the substring
// "error" inside benign lowercase prose (that stays the job of \berror\b above).
const EXCEPTION_NAME = /[A-Z][A-Za-z]*Error\b/;
const DIAGNOSTIC = /\(\d+,\d+\):\s+error\s+TS\d+:/;
const STACKTRACE = /^\s+at\s+.+:\d+:\d+/m;
const TEST_FAILURE = /^(?:FAIL|\s*[✗×])\s|\b\d+\s+failed\b/im;
const FILE_PATH = /[\w./-]+\.\w{1,5}(?::\d+)?/;
const NOISE = /^[\s.\-=*#]*$/;

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

function keywordScore(intent: string | undefined, text: string): number {
  if (intent === undefined) return 0;
  const wanted = new Set(tokenize(intent));
  if (wanted.size === 0) return 0;
  const present = new Set(tokenize(text));
  let hits = 0;
  for (const w of wanted) if (present.has(w)) hits += 1;
  return hits;
}

function recentFileScore(text: string, recentFiles: readonly string[] | undefined): number {
  if (recentFiles === undefined) return 0;
  let hits = 0;
  for (const file of recentFiles) if (text.includes(file)) hits += 1;
  return hits;
}

export function scoreChunk(
  intent: string | undefined,
  chunk: Chunk,
  sessionHints?: SessionHints,
): RankedChunk {
  const text = chunk.text;
  const features: RankFeatures = {
    diagnosticScore: DIAGNOSTIC.test(text) ? 5 : 0,
    duplicatePenalty: 0,
    errorScore: ERROR.test(text) || EXCEPTION_NAME.test(text) ? 4 : 0,
    filePathScore: FILE_PATH.test(text) ? 1 : 0,
    keywordScore: keywordScore(intent, text),
    noisePenalty: NOISE.test(text) ? 2 : 0,
    recentFileScore: recentFileScore(text, sessionHints?.recentFiles),
    stackTraceScore: STACKTRACE.test(`\n${text}`) ? 3 : 0,
    testFailureScore: TEST_FAILURE.test(text) ? 4 : 0,
  };

  const score =
    features.diagnosticScore +
    features.errorScore +
    features.filePathScore +
    features.keywordScore +
    features.recentFileScore +
    features.stackTraceScore +
    features.testFailureScore -
    features.duplicatePenalty -
    features.noisePenalty;

  return { text, startLine: chunk.startLine, endLine: chunk.endLine, score, features };
}

// §8.3 v1.2 weighting — base relevance dominates; memory and failure history
// are narrow boosts. LOCKED to three signals for v1.2 (repo index, dependency,
// recent-edit signals move to v1.3).
const BASE_WEIGHT = 0.7;
const MEMORY_WEIGHT = 0.15;
const FAILURE_WEIGHT = 0.15;
const ENGINE_RANKING_ENV_KEY = "MEGASAVER_ENGINE_RANKING";

// Only the literal "true" (trimmed, case-insensitive) enables engine-aware
// ranking; everything else (unset, "false", "1", garbage) leaves it off.
export function resolveEngineRanking(raw: string | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "true";
}

export function engineRankingFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEngineRanking(env[ENGINE_RANKING_ENV_KEY]);
}

// Fraction of hint items referenced by the chunk text, clamped to [0,1].
function fractionMatched(text: string, items: readonly string[] | undefined): number {
  if (items === undefined || items.length === 0) return 0;
  let hits = 0;
  for (const item of items) if (item.length > 0 && text.includes(item)) hits += 1;
  return Math.min(1, hits / items.length);
}

// Re-weight already-scored chunks using the shared base relevance plus the
// memory and failure-history boosts. This is NOT a second scorer: it consumes
// scoreChunk's output as base_output_relevance and only normalizes + combines.
// Caller gates this on the MEGASAVER_ENGINE_RANKING flag.
export function applyEngineRanking(
  chunks: readonly RankedChunk[],
  hints: SessionHints | undefined,
): RankedChunk[] {
  let maxBase = 0;
  for (const c of chunks) if (c.score > maxBase) maxBase = c.score;
  const memoryItems = [...(hints?.recentMemory ?? []), ...(hints?.projectConventions ?? [])];

  return chunks.map((c) => {
    const baseRelevance = maxBase > 0 ? Math.min(1, Math.max(0, c.score / maxBase)) : 0;
    const memoryBoost = fractionMatched(c.text, memoryItems);
    const failureHistoryBoost = fractionMatched(c.text, hints?.recentFailures);
    const finalScore =
      BASE_WEIGHT * baseRelevance +
      MEMORY_WEIGHT * memoryBoost +
      FAILURE_WEIGHT * failureHistoryBoost;
    return {
      ...c,
      score: finalScore,
      engine: { baseRelevance, memoryBoost, failureHistoryBoost, finalScore },
    };
  });
}
