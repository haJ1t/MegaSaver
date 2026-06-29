import { describe, expect, it } from "vitest";
import { contextPackSchema, scoreFactorsSchema } from "../src/pack.js";

const factors = {
  semanticRelevance: 0.9,
  dependencyRelevance: 0,
  coChangeRelevance: 0,
  testFailureRelevance: 0,
  recentEditRelevance: 0,
  memoryRelevance: 0,
  userMentionRelevance: 1,
  stalePenalty: 0,
  noisePenalty: 0,
};

const scored = {
  blockId: "00000000-0000-4000-8000-0000000000a1",
  filePath: "src/auth.ts",
  startLine: 1,
  endLine: 20,
  blockType: "function",
  name: "validateToken",
  score: 3.9,
  reasons: ["named in task"],
  factors,
};

const pack = {
  task: "fix login bug",
  included: [scored],
  excluded: [],
  budget: { maxTokens: 1000, usedTokens: 80, blocksConsidered: 1 },
};

describe("contextPackSchema", () => {
  it("validates a well-formed pack", () => {
    expect(contextPackSchema.parse(pack).included[0]?.blockId).toBe(scored.blockId);
  });

  it("requires every score factor", () => {
    const { semanticRelevance, ...partial } = factors;
    expect(scoreFactorsSchema.safeParse(partial).success).toBe(false);
    void semanticRelevance;
  });

  it("rejects an empty reason string", () => {
    const bad = { ...pack, included: [{ ...scored, reasons: [""] }] };
    expect(contextPackSchema.safeParse(bad).success).toBe(false);
  });

  it("allows a null maxTokens (no budget set)", () => {
    expect(
      contextPackSchema.safeParse({ ...pack, budget: { ...pack.budget, maxTokens: null } }).success,
    ).toBe(true);
  });

  it("rejects unknown keys (.strict)", () => {
    expect(contextPackSchema.safeParse({ ...pack, extra: 1 }).success).toBe(false);
  });
});
