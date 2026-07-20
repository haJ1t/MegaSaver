// Benchmark cost normalization. `total_cost_usd` from the Claude CLI reflects
// whatever tier served the request, so a fast-mode-billed run and a standard
// one price identical work differently. Pricing the token breakdown at fixed
// standard rates makes the gate metric independent of that: identical tokens
// always cost the same. Rates mirror scripts/benchmark-rates.json (a test
// asserts they stay in sync); that JSON is what the bash/python harness reads,
// so both consumers share one source.
//
// Measured caveat: all 24 saved benchmark results to date were standard-tier
// with fast mode off, where raw and normalized cost are already equal. This is
// insurance against a variance source that has not yet fired, not a fix for
// one that has.
export const BENCHMARK_RATES_PER_MTOK = {
  input: 5,
  cacheCreation: 10,
  cacheRead: 0.5,
  output: 25,
} as const;

export interface BenchmarkUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

export function normalizedCostUsd(usage: BenchmarkUsage): number {
  const r = BENCHMARK_RATES_PER_MTOK;
  return (
    ((usage.input_tokens ?? 0) * r.input +
      (usage.cache_creation_input_tokens ?? 0) * r.cacheCreation +
      (usage.cache_read_input_tokens ?? 0) * r.cacheRead +
      (usage.output_tokens ?? 0) * r.output) /
    1_000_000
  );
}
