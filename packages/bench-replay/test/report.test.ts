import { describe, expect, it } from "vitest";
import { buildVerdict, calibrationOk, verdictStable } from "../src/report.js";

const arm = (cost: number) => ({
  arm: "baseline" as const,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  normalizedCostUsd: cost,
  perRequest: [],
});

describe("buildVerdict", () => {
  it("ratio is baseline ÷ megasaver (>1 = megasaver cheaper)", () => {
    const v = buildVerdict("task_1", arm(1.0), { ...arm(0.8), arm: "megasaver" });
    expect(v.costRatio).toBeCloseTo(1.25, 6);
  });

  it("a zero-cost megasaver arm yields Infinity rather than NaN", () => {
    const v = buildVerdict("task_1", arm(1.0), { ...arm(0), arm: "megasaver" });
    expect(v.costRatio).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("calibrationOk", () => {
  it("passes when the replayed baseline is within tolerance of the real one", () => {
    expect(calibrationOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0.52, tolerance: 0.1 })).toBe(
      true,
    );
  });

  it("fails when the replayed baseline drifts beyond tolerance", () => {
    expect(calibrationOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0.8, tolerance: 0.1 })).toBe(
      false,
    );
  });

  it("fails (not passes) when the real baseline is zero — cannot calibrate against nothing", () => {
    expect(calibrationOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0, tolerance: 0.1 })).toBe(
      false,
    );
  });

  it("fails when a NaN replayed cost sneaks in", () => {
    expect(
      calibrationOk({ replayedBaselineUsd: Number.NaN, realBaselineUsd: 0.5, tolerance: 0.1 }),
    ).toBe(false);
  });
});

describe("verdictStable", () => {
  it("passes when a repeat replay's ratio is within tolerance", () => {
    expect(verdictStable(1.25, 1.26, 0.01)).toBe(true);
  });

  it("fails when a repeat replay's ratio drifts beyond tolerance", () => {
    expect(verdictStable(1.25, 1.5, 0.01)).toBe(false);
  });

  it("fails closed on NaN, zero, or negative ratios", () => {
    expect(verdictStable(Number.NaN, 1.0, 0.01)).toBe(false);
    expect(verdictStable(1.0, 0, 0.01)).toBe(false);
    expect(verdictStable(-1, 1, 0.01)).toBe(false);
  });

  it("treats two equal Infinity ratios (both arms zero-cost) as stable", () => {
    expect(verdictStable(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0.01)).toBe(true);
  });

  it("treats an Infinity vs finite ratio as unstable", () => {
    expect(verdictStable(Number.POSITIVE_INFINITY, 1.25, 0.01)).toBe(false);
  });
});
