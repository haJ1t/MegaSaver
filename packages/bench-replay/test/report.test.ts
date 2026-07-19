import { describe, expect, it } from "vitest";
import { buildVerdict, calibrationOk, verdictStable } from "../src/report.js";

const arm = (cost: number) => ({
  arm: "baseline" as const,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  normalizedCostUsd: cost,
  saver: { applied: 1, passthrough: 0, failed: 0 },
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

// Fix 2: a megasaver arm that compressed nothing is not a measurement — it is a
// second baseline. Reporting its costRatio ≈ 1.00 as "the saver has no effect"
// is the exact failure mode this harness exists to avoid, so the refusal lives
// in the only constructor of a verdict rather than in a caller that can skip it.
describe("buildVerdict refuses an inert megasaver arm", () => {
  const msArm = (applied: number) => ({
    ...arm(1),
    arm: "megasaver" as const,
    saver: { applied, passthrough: 5, failed: 0 },
  });

  it("throws when the megasaver arm applied the saver zero times", () => {
    expect(() => buildVerdict("t", arm(1), msArm(0))).toThrow(/applied the saver 0 times/);
  });

  it("emits a verdict once the saver was applied at least once", () => {
    expect(buildVerdict("t", arm(1), msArm(1)).costRatio).toBe(1);
  });
});
