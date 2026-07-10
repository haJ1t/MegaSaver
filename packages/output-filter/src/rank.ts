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
  // Ids of the memories whose hint term substring-matched this chunk. Pure
  // attribution — never read by scoring; the trace builder unions it across the
  // selected chunks into RankingTrace.rankedByMemoryIds.
  matchedMemoryIds?: string[];
};

export type SessionHints = {
  title?: string | null | undefined;
  recentFiles?: readonly string[] | undefined;
  recentMemory?: readonly string[] | undefined;
  projectConventions?: readonly string[] | undefined;
  // Signatures of prior failures (test names, error codes, …) for the
  // failure-history boost. Plumbed by the caller; the scorer only consumes it.
  recentFailures?: readonly string[] | undefined;
  // Parallel to recentMemory, carrying the memory id alongside each term for
  // ranking-causal attribution. NOT a scoring input — recentMemory remains the
  // sole memoryBoost source, so scores are byte-identical with or without this.
  memoryTerms?: readonly { id: string; text: string }[] | undefined;
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

// Matching normalization, not linguistic correctness: lowercase, strip
// combining marks after NFD (ç→c, ş→s, JS-lowercased İ→i̇→i), fold dotless
// ı→i (no NFD decomposition exists for it). Both sides of keywordScore run
// the same fold, so matching stays symmetric for any script; ASCII input
// tokenizes exactly as before.
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i")
    .split(/[^\p{L}\p{N}]+/u)
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

// An exact intent-token hit (whole word, not a substring) is the strongest
// relevance signal a read can carry: the user asked for `parseConfig`, this
// declaration IS `parseConfig`. Bump it decisively above raw error/diagnostic
// noise so a small intent-matched declaration is never out-ranked — and pinned
// by fitBudget when budget is tight. The bump dwarfs the max additive raw score
// (diagnostic 5 + error 4 + stack 3 + testFailure 4 + filePath 1 = 17) so one
// hit clears it; it scales with hit count without starving multi-signal blocks.
export const INTENT_MATCH_BUMP = 20;

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
    features.keywordScore * INTENT_MATCH_BUMP +
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

// A/B kill switch for the seam call sites (which pass engineRanking
// explicitly, so the opt-in resolver above never fires for them): the falsy
// spellings "false", "0", "off", "no" (trimmed, case-insensitive) disable —
// unset keeps the seam ON, letting an operator run seam-off sessions for
// comparison.
const ENGINE_RANKING_DISABLED_VALUES = new Set(["false", "0", "off", "no"]);

export function resolveEngineRankingDisabled(raw: string | undefined): boolean {
  return ENGINE_RANKING_DISABLED_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function engineRankingDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEngineRankingDisabled(env[ENGINE_RANKING_ENV_KEY]);
}

// Replay-trace recording is ON by default (the decision-trace viewer needs the
// causal record present without an opt-in step). A trace write is disabled only
// when MEGASAVER_SEAM_TRACE is EXPLICITLY one of the falsy spellings below
// (trimmed, case-insensitive); unset or anything else keeps tracing on. The
// retention prune bounds the resulting always-on disk.
const SEAM_TRACE_ENV_KEY = "MEGASAVER_SEAM_TRACE";
const SEAM_TRACE_DISABLED_VALUES = new Set(["false", "0", "off", "no"]);

export function resolveSeamTraceEnabled(raw: string | undefined): boolean {
  return !SEAM_TRACE_DISABLED_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function seamTraceEnabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSeamTraceEnabled(env[SEAM_TRACE_ENV_KEY]);
}

// Fraction of hint items referenced by the chunk text, clamped to [0,1].
function fractionMatched(text: string, items: readonly string[] | undefined): number {
  if (items === undefined || items.length === 0) return 0;
  let hits = 0;
  for (const item of items) if (item.length > 0 && text.includes(item)) hits += 1;
  return Math.min(1, hits / items.length);
}

// Ids of the memory terms whose text substring-matches the chunk. Mirrors
// fractionMatched's includes loop but collects ids instead of counting —
// attribution ONLY, never fed back into any score. Two terms with the same
// text but different ids each record their id.
function matchedMemoryIds(
  text: string,
  terms: readonly { id: string; text: string }[] | undefined,
): string[] {
  if (terms === undefined || terms.length === 0) return [];
  const ids: string[] = [];
  for (const term of terms) {
    if (term.text.length > 0 && text.includes(term.text) && !ids.includes(term.id)) {
      ids.push(term.id);
    }
  }
  return ids;
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
    // Attribution runs off memoryTerms (the id-carrying parallel field), NOT
    // memoryItems — so it cannot influence any score above.
    const attributed = matchedMemoryIds(c.text, hints?.memoryTerms);
    return {
      ...c,
      score: finalScore,
      engine: { baseRelevance, memoryBoost, failureHistoryBoost, finalScore },
      ...(attributed.length > 0 ? { matchedMemoryIds: attributed } : {}),
    };
  });
}
