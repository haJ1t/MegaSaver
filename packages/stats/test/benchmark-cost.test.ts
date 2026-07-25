import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BENCHMARK_RATES_PER_MTOK, normalizedCostUsd } from "../src/benchmark-cost.js";

// A usage object shaped like `claude --output-format json` .usage
const usage = (o: Partial<Parameters<typeof normalizedCostUsd>[0]>) => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  ...o,
});

describe("normalizedCostUsd", () => {
  it("prices each token class at its documented rate", () => {
    // 1M of each class, one at a time.
    expect(normalizedCostUsd(usage({ input_tokens: 1_000_000 }))).toBeCloseTo(5, 6);
    expect(normalizedCostUsd(usage({ cache_creation_input_tokens: 1_000_000 }))).toBeCloseTo(10, 6);
    expect(normalizedCostUsd(usage({ cache_read_input_tokens: 1_000_000 }))).toBeCloseTo(0.5, 6);
    expect(normalizedCostUsd(usage({ output_tokens: 1_000_000 }))).toBeCloseTo(25, 6);
  });

  it("sums the classes", () => {
    const cost = normalizedCostUsd(
      usage({
        input_tokens: 20_000,
        cache_creation_input_tokens: 48_000,
        cache_read_input_tokens: 134_000,
        output_tokens: 1_000,
      }),
    );
    // 0.1 + 0.48 + 0.067 + 0.025
    expect(cost).toBeCloseTo(0.672, 6);
  });

  // Normalized cost must ignore how the request was billed: the CLI's own
  // total_cost_usd reflects the serving tier, this must not.
  it("ignores non-token fields such as raw total_cost_usd", () => {
    const tokens = usage({
      input_tokens: 8,
      cache_creation_input_tokens: 48_681,
      cache_read_input_tokens: 134_075,
      output_tokens: 993,
    });
    expect(normalizedCostUsd({ ...tokens, total_cost_usd: 0.5787 })).toBe(
      normalizedCostUsd({ ...tokens, total_cost_usd: 0.3972 }),
    );
  });

  it("treats missing token fields as zero", () => {
    expect(normalizedCostUsd({} as never)).toBe(0);
  });

  it("constants stay in sync with scripts/benchmark-rates.json (single source)", () => {
    const jsonPath = fileURLToPath(
      new URL("../../../scripts/benchmark-rates.json", import.meta.url),
    );
    const onDisk = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(onDisk).toEqual(BENCHMARK_RATES_PER_MTOK);
  });
});
