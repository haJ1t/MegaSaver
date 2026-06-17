import { describe, expect, it } from "vitest";
import { SUFFICIENCY_FIXTURES } from "../src/sufficiency-fixtures.js";
import type { SufficiencyFixture } from "../src/sufficiency-fixtures.js";
import {
  type SufficiencyMetrics,
  computeSufficiencyMetrics,
  scoreActionabilityPassRate,
  scoreFailureEvidenceRecall,
  scoreFirstExpansionSuccessRate,
} from "../src/sufficiency-metrics.js";

describe("SUFFICIENCY_FIXTURES corpus", () => {
  it("is non-empty and every fixture has non-empty essentials array", () => {
    expect(SUFFICIENCY_FIXTURES.length).toBeGreaterThan(0);
    for (const f of SUFFICIENCY_FIXTURES) {
      expect(f.essentials.length).toBeGreaterThan(0);
    }
  });

  it("every fixture has rawContent and compressedContent as non-empty strings", () => {
    for (const f of SUFFICIENCY_FIXTURES) {
      expect(typeof f.rawContent).toBe("string");
      expect(f.rawContent.length).toBeGreaterThan(0);
      expect(typeof f.compressedContent).toBe("string");
    }
  });

  it("every actionability fixture has a nextAction string", () => {
    const actionable = SUFFICIENCY_FIXTURES.filter((f) => f.kind === "actionability");
    expect(actionable.length).toBeGreaterThan(0);
    for (const f of actionable) {
      expect(typeof f.nextAction).toBe("string");
      expect((f.nextAction as string).length).toBeGreaterThan(0);
    }
  });
});

describe("scoreFailureEvidenceRecall", () => {
  const failureFixture = SUFFICIENCY_FIXTURES.find((f) => f.kind === "failure_evidence");
  if (failureFixture === undefined) throw new Error("no failure_evidence fixture in corpus");

  it("returns 1 when all essentials present in compressed output", () => {
    // compressedContent in fixture already contains all essentials by design
    expect(scoreFailureEvidenceRecall([failureFixture], (f) => f.compressedContent)).toBe(1);
  });

  it("returns 0 when no essentials are present", () => {
    expect(scoreFailureEvidenceRecall([failureFixture], () => "completely unrelated text")).toBe(0);
  });

  it("partial recall: 2 of 3 essentials present = 2/3", () => {
    const fixture: SufficiencyFixture = {
      kind: "failure_evidence",
      rawContent: "raw",
      compressedContent: "abc def",
      essentials: ["abc", "def", "ghi"],
    };
    expect(scoreFailureEvidenceRecall([fixture], (f) => f.compressedContent)).toBeCloseTo(2 / 3, 5);
  });

  it("zero-guarded: empty corpus returns 0", () => {
    expect(scoreFailureEvidenceRecall([], (f) => f.compressedContent)).toBe(0);
  });
});

describe("scoreActionabilityPassRate", () => {
  it("returns 1 when all actionability fixtures have nextAction in compressed output", () => {
    const fixtures = SUFFICIENCY_FIXTURES.filter((f) => f.kind === "actionability");
    expect(scoreActionabilityPassRate(fixtures, (f) => f.compressedContent)).toBe(1);
  });

  it("returns 0 when nextAction not in output", () => {
    const fixtures = SUFFICIENCY_FIXTURES.filter((f) => f.kind === "actionability");
    expect(scoreActionabilityPassRate(fixtures, () => "irrelevant")).toBe(0);
  });

  it("zero-guarded: no actionability fixtures returns 0", () => {
    const failureOnly = SUFFICIENCY_FIXTURES.filter((f) => f.kind === "failure_evidence");
    expect(scoreActionabilityPassRate(failureOnly, (f) => f.compressedContent)).toBe(0);
  });
});

describe("scoreFirstExpansionSuccessRate", () => {
  it("rate is expansionsWithResult / total expansions, zero-guarded", () => {
    expect(scoreFirstExpansionSuccessRate(0, 0)).toBe(0);
    expect(scoreFirstExpansionSuccessRate(3, 4)).toBeCloseTo(0.75, 5);
    expect(scoreFirstExpansionSuccessRate(5, 5)).toBe(1);
  });
});

describe("computeSufficiencyMetrics", () => {
  it("returns all five fields, all in [0,1], using the default fixture corpus", () => {
    const result = computeSufficiencyMetrics({
      expandedCount: 3,
      totalCompressedResponses: 10,
      expansionsWithUsefulResult: 2,
      compressedOutputFor: (f) => f.compressedContent,
      secretBlockCount: 1,
      totalEligibleCount: 20,
    });
    expect(result.expandRate).toBeCloseTo(0.3, 5);
    expect(result.firstExpansionSuccessRate).toBeCloseTo(2 / 3, 5);
    expect(result.failureEvidenceRecall).toBeGreaterThanOrEqual(0);
    expect(result.failureEvidenceRecall).toBeLessThanOrEqual(1);
    expect(result.actionabilityFixturePassRate).toBeGreaterThanOrEqual(0);
    expect(result.actionabilityFixturePassRate).toBeLessThanOrEqual(1);
    expect(result.secretBlockRate).toBeCloseTo(0.05, 5);
  });

  it("all zeros with empty/zero inputs", () => {
    const result = computeSufficiencyMetrics({
      expandedCount: 0,
      totalCompressedResponses: 0,
      expansionsWithUsefulResult: 0,
      compressedOutputFor: () => "",
      secretBlockCount: 0,
      totalEligibleCount: 0,
    });
    for (const v of Object.values(result)) {
      expect(v).toBe(0);
    }
  });

  it("accepts an explicit fixtures override (dependency injection)", () => {
    const override = SUFFICIENCY_FIXTURES.filter((f) => f.kind === "actionability");
    const result = computeSufficiencyMetrics({
      expandedCount: 1,
      totalCompressedResponses: 2,
      expansionsWithUsefulResult: 1,
      compressedOutputFor: (f) => f.compressedContent,
      secretBlockCount: 0,
      totalEligibleCount: 5,
      fixtures: override,
    });
    expect(result.actionabilityFixturePassRate).toBe(1);
  });
});
