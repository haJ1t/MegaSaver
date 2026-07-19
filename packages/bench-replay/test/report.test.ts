import { describe, expect, it } from "vitest";
import {
  MIN_DRIFT_SMOKE_TOLERANCE,
  baselineDriftSmokeOk,
  buildVerdict,
  checkArmIntegrity,
  verdictStable,
} from "../src/report.js";

const arm = (cost: number) => ({
  arm: "baseline" as const,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  normalizedCostUsd: cost,
  saver: { applied: 1, passthrough: 0, failed: 0 },
  // Fix B: a verdict is only constructible for an arm whose transform actually
  // shrank the payload, so the shared fixture has to carry real compression.
  bytes: { original: 1000, transformed: 400 },
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

describe("baselineDriftSmokeOk", () => {
  it("passes when the replayed baseline is within tolerance of the real one", () => {
    expect(
      baselineDriftSmokeOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0.52, tolerance: 0.1 }),
    ).toBe(true);
  });

  it("fails when the replayed baseline drifts beyond tolerance", () => {
    expect(
      baselineDriftSmokeOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0.8, tolerance: 0.1 }),
    ).toBe(false);
  });

  it("fails (not passes) when the real baseline is zero — cannot calibrate against nothing", () => {
    expect(
      baselineDriftSmokeOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0, tolerance: 0.1 }),
    ).toBe(false);
  });

  it("fails when a NaN replayed cost sneaks in", () => {
    expect(
      baselineDriftSmokeOk({
        replayedBaselineUsd: Number.NaN,
        realBaselineUsd: 0.5,
        tolerance: 0.1,
      }),
    ).toBe(false);
  });

  // Fix B: the reference is a DIFFERENT agent conversation, so agreement inside
  // a few percent is coincidence, not calibration. Accepting a tight tolerance
  // would let a caller present this smoke check as a precision instrument.
  it("rejects a tolerance tight enough to imply precision it cannot deliver", () => {
    expect(() =>
      baselineDriftSmokeOk({ replayedBaselineUsd: 0.5, realBaselineUsd: 0.5, tolerance: 0.02 }),
    ).toThrow(/gross-drift smoke check/);
  });

  it("accepts exactly the documented floor", () => {
    expect(MIN_DRIFT_SMOKE_TOLERANCE).toBe(0.1);
    expect(
      baselineDriftSmokeOk({
        replayedBaselineUsd: 0.5,
        realBaselineUsd: 0.5,
        tolerance: MIN_DRIFT_SMOKE_TOLERANCE,
      }),
    ).toBe(true);
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

// Fix B: `applied > 0` only proves the saver RETURNED something. An arm whose
// transform gave back the same bytes (or more) measures nothing, and the guard
// that used to sit here watched the baseline arm — the one with no moving parts.
describe("checkArmIntegrity", () => {
  const ms = (original: number, transformed: number, applied = 2) => ({
    ...arm(1),
    arm: "megasaver" as const,
    saver: { applied, passthrough: 0, failed: 0 },
    bytes: { original, transformed },
  });

  it("passes and reports the byte ratio when the transform shrank the payload", () => {
    const r = checkArmIntegrity(ms(1000, 250));
    expect(r.ok).toBe(true);
    expect(r.byteRatio).toBeCloseTo(0.25, 6);
  });

  it("fails when the transformed bytes are not strictly less than the original", () => {
    expect(checkArmIntegrity(ms(1000, 1000)).ok).toBe(false);
    expect(checkArmIntegrity(ms(1000, 1200)).ok).toBe(false);
  });

  it("fails when the saver was never applied", () => {
    expect(checkArmIntegrity(ms(1000, 250, 0)).ok).toBe(false);
  });

  it("fails when there were no tool_result bytes to compress at all", () => {
    expect(checkArmIntegrity(ms(0, 0)).ok).toBe(false);
  });
});

describe("buildVerdict integrity refusal and verification metadata", () => {
  const inert = {
    ...arm(0.8),
    arm: "megasaver" as const,
    bytes: { original: 1000, transformed: 1000 },
  };

  it("refuses a verdict when the megasaver arm produced no byte reduction", () => {
    expect(() => buildVerdict("t", arm(1), inert)).toThrow(/no byte reduction/);
  });

  it("carries what was verified so a smoke-tested number cannot read as calibrated", () => {
    const v = buildVerdict("t", arm(1), { ...arm(0.8), arm: "megasaver" as const });
    expect(v.verified.integrity.ok).toBe(true);
    expect(v.verified.integrity.byteRatio).toBeCloseTo(0.4, 6);
    // Not run unless the caller ran them and passed the results in — an absent
    // check must read as "unverified", never as "passed".
    expect(v.verified.order).toBeNull();
    expect(v.verified.baselineDriftSmoke).toBeNull();
  });

  it("records a drift smoke result and its tolerance when the caller ran one", () => {
    const v = buildVerdict(
      "t",
      arm(1),
      { ...arm(0.8), arm: "megasaver" as const },
      { baselineDriftSmoke: { ok: true, tolerance: 0.25 } },
    );
    expect(v.verified.baselineDriftSmoke).toEqual({ ok: true, tolerance: 0.25 });
  });
});
