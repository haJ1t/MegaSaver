import { describe, expect, it } from "vitest";
import { HARD_CEILING_BYTES, effectiveBudget, fitBudget } from "../src/fit.js";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import type { RankFeatures, RankedChunk } from "../src/rank.js";

const zeroFeatures = (): RankFeatures =>
  Object.fromEntries(rankFeatureNameSchema.options.map((n) => [n, 0])) as RankFeatures;

const ranked = (text: string, score: number): RankedChunk => ({
  text,
  startLine: 1,
  endLine: 1,
  score,
  features: zeroFeatures(),
});

describe("fitBudget (spec §6 stage 7)", () => {
  it("greedily picks highest-scoring chunks within budget", () => {
    const out = fitBudget([ranked("a".repeat(10), 1), ranked("b".repeat(10), 9)], 10);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("b".repeat(10));
  });

  it("stops before exceeding the budget", () => {
    const out = fitBudget([ranked("a".repeat(6), 9), ranked("b".repeat(6), 8)], 10);
    expect(out).toHaveLength(1);
  });

  it("measures budget in UTF-8 bytes", () => {
    const out = fitBudget([ranked("€", 1)], 2);
    expect(out).toHaveLength(0);
  });
});

describe("effectiveBudget (spec §6.1 + §8a hard ceiling)", () => {
  it("falls back to the mode budget when no override", () => {
    expect(effectiveBudget(undefined, 12_000)).toBe(12_000);
  });

  it("uses the override when below the hard ceiling", () => {
    expect(effectiveBudget(5_000, 12_000)).toBe(5_000);
  });

  it("clamps an over-ceiling override to the hard ceiling", () => {
    expect(effectiveBudget(999_999, 12_000)).toBe(HARD_CEILING_BYTES);
  });

  it("pins the hard ceiling at 64000", () => {
    expect(HARD_CEILING_BYTES).toBe(64_000);
  });
});
