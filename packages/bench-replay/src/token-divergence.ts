import { countTokens, estimateTokens } from "@megasaver/output-filter";

export type TokenDivergenceSample = {
  name: string;
  bytes: number;
  estimatedTokens: number;
  realTokens: number;
  // real / estimated — >1 means bytes/4 UNDERSTATES tokens (reported savings
  // were optimistic in token terms), <1 means it overstates.
  realOverEstimate: number;
};

export type TokenDivergenceReport = {
  encoding: string;
  samples: TokenDivergenceSample[];
  overallRealOverEstimate: number;
  // Corpora whose real count the tokenizer declined (over output-filter's work
  // budget). Named, not dropped: a divergence figure must say what it did not
  // cover.
  excludedCorpora: string[];
};

export type TokenCounters = {
  estimate(text: string): number;
  count(text: string): Promise<number | null>;
};

const defaultCounters: TokenCounters = { estimate: estimateTokens, count: countTokens };

// B4: measure how far the bytes/4 heuristic drifts from a real BPE count per
// content class. Track A's strengthened admission guard derives its threshold
// from these numbers — do not round them away.
export async function measureTokenDivergence(
  corpora: ReadonlyArray<{ name: string; text: string }>,
  counters: TokenCounters = defaultCounters,
): Promise<TokenDivergenceReport> {
  const samples: TokenDivergenceSample[] = [];
  const excludedCorpora: string[] = [];
  for (const corpus of corpora) {
    const realTokens = await counters.count(corpus.text);
    if (realTokens === null) {
      excludedCorpora.push(corpus.name);
      continue;
    }
    const estimatedTokens = counters.estimate(corpus.text);
    samples.push({
      name: corpus.name,
      bytes: Buffer.byteLength(corpus.text, "utf8"),
      estimatedTokens,
      realTokens,
      realOverEstimate: estimatedTokens === 0 ? 1 : realTokens / estimatedTokens,
    });
  }
  const estimatedTotal = samples.reduce((s, x) => s + x.estimatedTokens, 0);
  const realTotal = samples.reduce((s, x) => s + x.realTokens, 0);
  return {
    encoding: "cl100k_base",
    samples,
    overallRealOverEstimate: estimatedTotal === 0 ? 1 : realTotal / estimatedTotal,
    excludedCorpora,
  };
}
