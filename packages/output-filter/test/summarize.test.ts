import { describe, expect, it } from "vitest";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import type { RankFeatures, RankedChunk } from "../src/rank.js";
import { summarize } from "../src/summarize.js";

const zeroFeatures = (): RankFeatures =>
  Object.fromEntries(rankFeatureNameSchema.options.map((n) => [n, 0])) as RankFeatures;

const ranked = (text: string, score: number): RankedChunk => ({
  text,
  startLine: 1,
  endLine: 1,
  score,
  features: zeroFeatures(),
});

const kept = [ranked("Error: boom", 10), ranked("ok line", 1)];

describe("summarize (spec §6 stage 8)", () => {
  it("is deterministic for identical inputs", () => {
    expect(summarize("balanced", kept, 3)).toBe(summarize("balanced", kept, 3));
  });

  it("scales summary length by mode: safe >= balanced >= aggressive", () => {
    const safe = summarize("safe", kept, 3).length;
    const balanced = summarize("balanced", kept, 3).length;
    const aggressive = summarize("aggressive", kept, 3).length;
    expect(safe).toBeGreaterThanOrEqual(balanced);
    expect(balanced).toBeGreaterThanOrEqual(aggressive);
  });

  it("reports kept and dropped counts", () => {
    const summary = summarize("safe", kept, 3);
    expect(summary).toContain("2");
    expect(summary).toContain("3");
  });

  it("surfaces the top error line", () => {
    expect(summarize("safe", kept, 0)).toContain("Error: boom");
  });
});
