import { describe, expect, it } from "vitest";
import {
  MIN_DRIFT_SMOKE_TOLERANCE,
  baselineDriftSmokeOk,
  buildVerdict,
  checkTransformIntegrity,
  costRatioOf,
  pooledCostRatio,
  verdictStable,
} from "../src/report.js";
import type { PairResult, ReplayOrder } from "../src/types.js";

const arm = (cost: number) => ({
  arm: "baseline" as const,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  normalizedCostUsd: cost,
  startedAtMs: 0,
  finishedAtMs: 1,
  perRequest: [],
});

// Fix B: a verdict is only constructible for a transform that actually shrank
// the payload, so the shared fixture has to carry real compression.
const transform = {
  saver: { applied: 1, passthrough: 0, failed: 0 },
  bytes: { original: 1000, transformed: 400 },
};

// One pair, ratio = baselineCost ÷ megasaverCost.
const pair = (
  baselineCost: number,
  megasaverCost: number,
  order: ReplayOrder = "baseline-first",
): PairResult => {
  const baseline = arm(baselineCost);
  const megasaver = { ...arm(megasaverCost), arm: "megasaver" as const };
  return { order, baseline, megasaver, costRatio: costRatioOf(baseline, megasaver) };
};

describe("buildVerdict", () => {
  it("ratio is baseline ÷ megasaver (>1 = megasaver cheaper)", () => {
    const v = buildVerdict("task_1", [pair(1.0, 0.8)], transform);
    expect(v.costRatio).toBeCloseTo(1.25, 6);
  });

  it("a zero-cost megasaver arm yields Infinity rather than NaN", () => {
    const v = buildVerdict("task_1", [pair(1.0, 0)], transform);
    expect(v.costRatio).toBe(Number.POSITIVE_INFINITY);
  });

  it("refuses to report anything when no pair was replayed", () => {
    expect(() => buildVerdict("task_1", [], transform)).toThrow(/no pair was replayed/);
  });

  // The reported number must be accounted for by the arms shown beside it. A
  // multi-pair run is only collapsible into one ratio by the order check that
  // combined them; without it, quoting any single pair's ratio would be
  // reporting a number the other pair's arms contradict.
  it("refuses a multi-pair verdict that no order check combined", () => {
    expect(() =>
      buildVerdict("task_1", [pair(1.0, 0.8), pair(1.0, 0.8, "megasaver-first")], transform),
    ).toThrow(/no order check combined them/);
  });

  it("reports every pair it was given alongside the combined ratio", () => {
    const v = buildVerdict(
      "task_1",
      [pair(1.0, 0.8), pair(1.0, 0.5, "megasaver-first")],
      transform,
      {
        order: {
          ratioBaselineFirst: 1.25,
          ratioMegasaverFirst: 2,
          spread: 0.6,
          tolerance: 0.75,
          combinedRatio: 1.625,
        },
      },
    );
    expect(v.pairs.map((p) => p.order)).toEqual(["baseline-first", "megasaver-first"]);
    expect(v.costRatio).toBeCloseTo(1.625, 6);
    // The counters shown belong to the one transform both pairs replayed.
    expect(v.transform).toEqual(transform);
  });
});

describe("pooledCostRatio", () => {
  const verdict = (ratio: number) => buildVerdict("t", [pair(ratio, 1)], transform);

  it("is the geometric mean of the per-task ratios", () => {
    expect(pooledCostRatio([verdict(4), verdict(1)])).toBeCloseTo(2, 9);
  });

  it("a single task pools to its own ratio", () => {
    expect(pooledCostRatio([verdict(1.25)])).toBeCloseTo(1.25, 9);
  });

  it("refuses to pool an empty set", () => {
    expect(pooledCostRatio([])).toBeNaN();
  });

  it("refuses to pool when any task ratio is not finite and positive", () => {
    const infinite = buildVerdict("t", [pair(1, 0)], transform);
    expect(pooledCostRatio([verdict(2), infinite])).toBeNaN();
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

// Fix 2: a transform that compressed nothing is not a measurement — it makes
// the megasaver arm a second baseline. Reporting its costRatio ≈ 1.00 as "the
// saver has no effect" is the exact failure mode this harness exists to avoid,
// so the refusal lives in the only constructor of a verdict rather than in a
// caller that can skip it.
describe("buildVerdict refuses an inert transform", () => {
  const applied = (n: number) => ({
    saver: { applied: n, passthrough: 5, failed: 0 },
    bytes: { original: 1000, transformed: 400 },
  });

  it("throws when the saver was applied zero times", () => {
    expect(() => buildVerdict("t", [pair(1, 1)], applied(0))).toThrow(/applied the saver 0 times/);
  });

  it("emits a verdict once the saver was applied at least once", () => {
    expect(buildVerdict("t", [pair(1, 1)], applied(1)).costRatio).toBe(1);
  });
});

// Fix B: `applied > 0` only proves the saver RETURNED something. A transform
// that gave back the same bytes (or more) measures nothing. It runs once for the
// whole gate, so this one check necessarily covers every pair's megasaver arm.
describe("checkTransformIntegrity", () => {
  const ms = (original: number, transformed: number, applied = 2) => ({
    saver: { applied, passthrough: 0, failed: 0 },
    bytes: { original, transformed },
  });

  it("passes and reports the byte ratio when the transform shrank the payload", () => {
    const r = checkTransformIntegrity(ms(1000, 250));
    expect(r.ok).toBe(true);
    expect(r.byteRatio).toBeCloseTo(0.25, 6);
  });

  it("fails when the transformed bytes are not strictly less than the original", () => {
    expect(checkTransformIntegrity(ms(1000, 1000)).ok).toBe(false);
    expect(checkTransformIntegrity(ms(1000, 1200)).ok).toBe(false);
  });

  it("fails when the saver was never applied", () => {
    expect(checkTransformIntegrity(ms(1000, 250, 0)).ok).toBe(false);
  });

  it("fails when there were no tool_result bytes to compress at all", () => {
    expect(checkTransformIntegrity(ms(0, 0)).ok).toBe(false);
  });
});

describe("buildVerdict integrity refusal and verification metadata", () => {
  const inert = {
    saver: { applied: 1, passthrough: 0, failed: 0 },
    bytes: { original: 1000, transformed: 1000 },
  };

  it("refuses a verdict when the transform produced no byte reduction", () => {
    expect(() => buildVerdict("t", [pair(1, 0.8)], inert)).toThrow(/no byte reduction/);
  });

  it("carries what was verified so a smoke-tested number cannot read as calibrated", () => {
    const v = buildVerdict("t", [pair(1, 0.8)], transform);
    expect(v.verified.integrity.ok).toBe(true);
    expect(v.verified.integrity.byteRatio).toBeCloseTo(0.4, 6);
    // Not run unless the caller ran them and passed the results in — an absent
    // check must read as "unverified", never as "passed".
    expect(v.verified.order).toBeNull();
    expect(v.verified.baselineDriftSmoke).toBeNull();
  });

  it("records a drift smoke result and its tolerance when the caller ran one", () => {
    const v = buildVerdict("t", [pair(1, 0.8)], transform, {
      baselineDriftSmoke: { ok: true, tolerance: 0.25 },
    });
    expect(v.verified.baselineDriftSmoke).toEqual({ ok: true, tolerance: 0.25 });
  });
});
