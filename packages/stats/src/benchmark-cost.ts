// Benchmark cost normalization. `total_cost_usd` from the Claude CLI mixes
// 1x- and 2x-billed (fast-mode) requests, so two runs of identical work can
// differ ~1.45x — larger than any effect a benchmark is trying to measure.
// Pricing the token breakdown at fixed standard rates removes that artifact:
// identical tokens always cost the same. Rates mirror scripts/benchmark-rates.json
// (a test asserts they stay in sync); that JSON is what the bash/python harness
// reads, so both consumers share one source.
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
