import type { RankFeatureName } from "./rank-features.js";

export type RankFeatures = Record<RankFeatureName, number>;

export type RankedChunk = {
  text: string;
  startLine: number;
  endLine: number;
  score: number;
  features: RankFeatures;
};

export type SessionHints = {
  title?: string | null | undefined;
  recentFiles?: readonly string[] | undefined;
  recentMemory?: readonly string[] | undefined;
  projectConventions?: readonly string[] | undefined;
};

export type Chunk = {
  text: string;
  startLine: number;
  endLine: number;
};

const ERROR = /\berror\b|\bfailed\b|\bfailure\b|\bexception\b|\bpanic\b/i;
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
    errorScore: ERROR.test(text) ? 4 : 0,
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
