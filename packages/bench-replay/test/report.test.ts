import { describe, expect, it } from "vitest";
import {
  MAX_BYTE_RATIO,
  MIN_APPLIED_FRACTION,
  MIN_DRIFT_SMOKE_TOLERANCE,
  baselineDriftSmokeOk,
  buildVerdict,
  checkTransformIntegrity,
  costRatioOf,
  modelHistogram,
  pooledCostRatio,
  verdictStable,
} from "../src/report.js";
import { GENERATION_CAP_TOKENS } from "../src/transform.js";
import type { PairResult, RecordedRequest, ReplayOrder } from "../src/types.js";

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
      { orderTolerance: 0.75 },
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
    expect(() => buildVerdict("t", [pair(1, 0.8)], inert)).toThrow(/measured nothing/);
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

// DEFECT 2 (round 3) put a two-sided band here. ROUND 4 showed why that could
// never work: both axes are conversation-wide AGGREGATES while a saver breaks per
// call, so any destructive transform could be moved inside the band by shrinking
// its blast radius. Destructiveness moved to a per-call contract in prepareArms
// (see saver-call-contract.test.ts) and the byte FLOOR was removed with it — it
// was standing in for a question it could not answer, while refusing the
// aggressive/large-output regime the saver performs best in.
//
// What remains here is the one question that IS aggregate: is there enough
// movement for this instrument to resolve anything at all?
describe("checkTransformIntegrity resolution ceiling", () => {
  // 1 block of 100 rewritten, shrunk 3 bytes. Measured {applied:1,
  // passthrough:99, byteRatio 0.999942, ok:true} at costRatio 1.000081 — a
  // 99%-broken saver certified as a real "no effect" finding.
  const nearInert = {
    saver: { applied: 1, passthrough: 99, failed: 0 },
    bytes: { original: 51390, transformed: 51387 },
  };

  it("fails a near-inert saver on both the applied fraction and the byte ratio", () => {
    const r = checkTransformIntegrity(nearInert);
    expect(r.appliedFraction).toBeCloseTo(0.01, 6);
    expect(r.ok).toBe(false);
  });

  // The ceiling is derived from the question being asked, not fitted to an
  // escape: `1 - byteRatio` bounds the input-side cost effect from above, so
  // anything above 0.95 cannot reach the ≤5% band at all.
  it("refuses a transform whose maximum possible cost effect is under 5%", () => {
    const r = checkTransformIntegrity({
      saver: { applied: 20, passthrough: 80, failed: 0 },
      bytes: { original: 500_000, transformed: 485_000 },
    });
    expect(r.byteRatio).toBeCloseTo(0.97, 6);
    expect(r.ok).toBe(false);
  });

  // The escape the removed floor used to cause. An absolute-budget saver on large
  // outputs lands here legitimately, and refusing it refused the measurement the
  // harness most wants.
  it("accepts a very high compression ratio instead of mistaking it for content loss", () => {
    const r = checkTransformIntegrity({
      saver: { applied: 10, passthrough: 0, failed: 0 },
      bytes: { original: 1_024_000, transformed: 40_000 },
    });
    expect(r.byteRatio).toBeCloseTo(0.039, 3);
    expect(r.ok).toBe(true);
  });

  it("reports the applied fraction so a passthrough-heavy run is visible", () => {
    expect(
      checkTransformIntegrity({
        saver: { applied: 3, passthrough: 1, failed: 0 },
        bytes: { original: 1000, transformed: 400 },
      }).appliedFraction,
    ).toBeCloseTo(0.75, 6);
  });

  it("exposes the thresholds it enforces rather than burying them", () => {
    expect(MIN_APPLIED_FRACTION).toBeGreaterThan(0.01);
    expect(MAX_BYTE_RATIO).toBeLessThanOrEqual(0.95);
  });

  it("refuses a verdict for a transform it cannot resolve rather than printing one", () => {
    expect(() => buildVerdict("t", [pair(1.000081, 1)], nearInert)).toThrow(/measured nothing/);
  });
});

// DEFECT 3: buildVerdict never checked that the OrderCheck it was handed was
// computed from the pairs it was handed. A reviewer passed pairs with ratios
// 1.05 and 1.06 plus OrderCheck{combinedRatio: 9} and got a verdict reporting
// costRatio 9 beside those pairs, with no refusal. The fix is structural: the
// caller passes a tolerance, never a number, so there is nothing to mismatch.
describe("buildVerdict derives its order check from the pairs", () => {
  it("computes the combined ratio from the pairs it was given", () => {
    const v = buildVerdict("t", [pair(1.05, 1), pair(1.06, 1, "megasaver-first")], transform, {
      orderTolerance: 0.05,
    });
    expect(v.costRatio).toBeCloseTo(1.055, 9);
    expect(v.verified.order?.ratioBaselineFirst).toBeCloseTo(1.05, 9);
    expect(v.verified.order?.ratioMegasaverFirst).toBeCloseTo(1.06, 9);
  });

  it("refuses when the pairs are not one of each order", () => {
    expect(() =>
      buildVerdict("t", [pair(1.05, 1), pair(1.06, 1)], transform, { orderTolerance: 0.05 }),
    ).toThrow(/one baseline-first and one megasaver-first/);
  });

  it("refuses order-sensitive pairs at the one place a verdict is constructed", () => {
    expect(() =>
      buildVerdict("t", [pair(1.25, 1), pair(1.0, 1, "megasaver-first")], transform, {
        orderTolerance: 0.05,
      }),
    ).toThrow(/order-sensitive/);
  });
});

// BLOCKER visibility: a reader must not mistake a generation-capped, input-side
// ratio for an end-to-end cost comparison.
describe("buildVerdict carries the generation cap", () => {
  it("states the cap the arms were replayed under", () => {
    const cap = buildVerdict("t", [pair(1, 0.8)], transform).generationCapTokens;
    expect(cap).toBe(GENERATION_CAP_TOKENS);
    expect(cap).toBeGreaterThan(0);
  });
});

// MODEL-BLIND COST: the cost model prices every request at one flat rate card,
// but a recording holds every /v1/messages call the agent made — including Claude
// Code's sidecar Haiku calls, which carry no tool_result, are byte-identical in
// both arms, and drag the ratio toward 1.00 at ~6x their true weight. Nothing
// downstream read `model` at all, so the error was unbounded AND invisible. It
// stays unpriced; it stops being invisible.
describe("modelHistogram", () => {
  const req = (model: string): RecordedRequest => ({ model, messages: [] });

  it("counts requests per model, busiest first", () => {
    expect(
      modelHistogram([
        req("claude-opus-4-8"),
        req("claude-haiku-4-5"),
        req("claude-opus-4-8"),
        req("claude-opus-4-8"),
      ]),
    ).toEqual([
      { model: "claude-opus-4-8", requests: 3 },
      { model: "claude-haiku-4-5", requests: 1 },
    ]);
  });

  it("makes a sidecar-diluted recording visible as more than one row", () => {
    const requests = [
      ...Array.from({ length: 97 }, () => req("claude-opus-4-8")),
      ...Array.from({ length: 34 }, () => req("claude-haiku-4-5")),
    ];
    const histogram = modelHistogram(requests);
    expect(histogram).toHaveLength(2);
    // A reader can bound the dilution from this alone: 26% of requests are priced
    // at ~6x their true cost, and they move the ratio toward 1.00.
    expect(histogram[1]).toEqual({ model: "claude-haiku-4-5", requests: 34 });
  });

  it("ties break on model name so the printed order is stable across runs", () => {
    expect(modelHistogram([req("b"), req("a")]).map((r) => r.model)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty recording rather than inventing a row", () => {
    expect(modelHistogram([])).toEqual([]);
  });
});
