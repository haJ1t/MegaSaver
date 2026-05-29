import { z } from "zod";
import { RetrievalError } from "./errors.js";

export type Bm25Document = {
  id: string;
  text: string;
};

export type Bm25RankInput = {
  query: string;
  documents: readonly Bm25Document[];
  topN: number;
  k1?: number;
  b?: number;
};

export type Bm25Result = {
  id: string;
  score: number;
};

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

const rankInputSchema = z
  .object({
    topN: z.number().int().positive(),
    k1: z.number().finite().positive().optional(),
    b: z.number().finite().min(0).max(1).optional(),
  })
  .passthrough();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0);
}

export function rankBm25(input: Bm25RankInput): Bm25Result[] {
  const parsed = rankInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RetrievalError("invalid_input");
  }

  const { query, documents, topN } = input;
  const k1 = input.k1 ?? DEFAULT_K1;
  const b = input.b ?? DEFAULT_B;

  const docTokens = documents.map((doc) => tokenize(doc.text));
  const docLengths = docTokens.map((tokens) => tokens.length);
  const totalLength = docLengths.reduce((sum, len) => sum + len, 0);
  const avgDocLength = documents.length > 0 ? totalLength / documents.length : 0;

  const queryTerms = [...new Set(tokenize(query))];

  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    let df = 0;
    for (const tokens of docTokens) {
      if (tokens.includes(term)) {
        df += 1;
      }
    }
    documentFrequency.set(term, df);
  }

  const n = documents.length;
  const scored = documents.map((doc, index) => {
    let score = 0;
    const tokens = docTokens[index] ?? [];
    const docLength = docLengths[index] ?? 0;
    for (const term of queryTerms) {
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      let tf = 0;
      for (const token of tokens) {
        if (token === term) {
          tf += 1;
        }
      }
      const denom = tf + k1 * (1 - b + (b * docLength) / (avgDocLength || 1));
      if (denom > 0) {
        score += idf * ((tf * (k1 + 1)) / denom);
      }
    }
    return { id: doc.id, score, index };
  });

  scored.sort((a, b2) => (b2.score === a.score ? a.index - b2.index : b2.score - a.score));

  return scored.slice(0, topN).map(({ id, score }) => ({ id, score }));
}
