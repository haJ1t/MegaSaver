import { describe, expect, it } from "vitest";
import { HAMMING_DEDUPE_THRESHOLD, dedupe } from "../src/dedupe.js";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import type { RankFeatures, RankedChunk } from "../src/rank.js";
import { hammingDistance, simhash } from "../src/simhash.js";

const zeroFeatures = (): RankFeatures =>
  Object.fromEntries(rankFeatureNameSchema.options.map((n) => [n, 0])) as RankFeatures;

const ranked = (text: string, score: number): RankedChunk => ({
  text,
  startLine: 1,
  endLine: 1,
  score,
  features: zeroFeatures(),
});

describe("simhash + hamming (spec §6 stage 6)", () => {
  it("identical text has hamming distance 0", () => {
    const a = simhash("the quick brown fox jumps over the lazy dog");
    const b = simhash("the quick brown fox jumps over the lazy dog");
    expect(hammingDistance(a, b)).toBe(0);
  });

  it("very different text has large hamming distance", () => {
    const a = simhash("alpha beta gamma delta epsilon zeta eta theta");
    const b = simhash("one two three four five six seven eight nine ten");
    expect(hammingDistance(a, b)).toBeGreaterThan(HAMMING_DEDUPE_THRESHOLD);
  });
});

describe("dedupe (spec §6 stage 6)", () => {
  it("drops a near-duplicate chunk within the hamming threshold", () => {
    const base = "the quick brown fox jumps over the lazy dog tonight";
    const out = dedupe([ranked(base, 10), ranked(`${base}.`, 5)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(10);
  });

  it("keeps distinct chunks", () => {
    const out = dedupe([
      ranked("alpha beta gamma delta epsilon zeta", 10),
      ranked("one two three four five six seven", 5),
    ]);
    expect(out).toHaveLength(2);
  });

  it("pins the dedupe threshold at 3", () => {
    expect(HAMMING_DEDUPE_THRESHOLD).toBe(3);
  });
});
