import { describe, expect, it } from "vitest";
import { PRO_PRICE_USD_PER_MONTH, computeRoi } from "../src/roi.js";

// tokensFromBytes is bytes/4 (see @megasaver/stats); 4_000_000 bytes → 1_000_000
// tokens → $3.00 at INPUT_PRICE_PER_MTOK_USD = 3.0.
function ev(createdAt: string, bytesSaved: number, i: number) {
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt,
    sourceKind: "file",
    label: "read",
    rawBytes: bytesSaved * 2,
    returnedBytes: bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "",
    mode: "safe",
  } as never;
}

const NOW = Date.UTC(2026, 6, 15, 0, 0, 0); // 2026-07-15T00:00:00Z, mid-July (31-day month)

// Two in-month events: 8_000_000 bytes → 2_000_000 tokens → $6.00 saved so far.
const events = [
  ev("2026-07-05T00:00:00.000Z", 4_000_000, 0),
  ev("2026-07-10T00:00:00.000Z", 4_000_000, 1),
  ev("2026-06-30T00:00:00.000Z", 40_000_000, 2), // previous month → excluded
];

describe("computeRoi", () => {
  it("divides saved and projected dollars by the price", () => {
    const r = computeRoi(events, { now: NOW, priceUsd: 7.99 });
    expect(r.period).toBe("month");
    expect(r.priceUsd).toBe(7.99);
    expect(r.savedSoFar.dollars).toBeCloseTo(6);
    expect(r.roiSoFar).toBeCloseTo(6 / 7.99);
    // run-rate: $6 over 14 elapsed days of 31 → ×(31/14) at month end.
    expect(r.projectedEnd.dollars).toBeCloseTo(6 * (31 / 14));
    expect(r.roiProjected).toBeCloseTo((6 * (31 / 14)) / 7.99);
    expect(r.daysLeft).toBeCloseTo(17);
  });

  it("contextWindowsReclaimed = savedTokens / 200_000", () => {
    const r = computeRoi(events, { now: NOW, priceUsd: 7.99 });
    expect(r.savedSoFar.tokens).toBe(2_000_000);
    expect(r.contextWindowsReclaimed).toBeCloseTo(10);
  });

  it("paidForItself is >= 1 on the exact boundary", () => {
    expect(computeRoi(events, { now: NOW, priceUsd: 6 }).paidForItself).toBe(true); // 6/6 = 1
    expect(computeRoi(events, { now: NOW, priceUsd: 6.01 }).paidForItself).toBe(false);
  });

  it("priceUsd <= 0 → roi fields 0, no NaN/Infinity", () => {
    const r = computeRoi(events, { now: NOW, priceUsd: 0 });
    expect(r.roiSoFar).toBe(0);
    expect(r.roiProjected).toBe(0);
    expect(r.paidForItself).toBe(false);
    expect(Number.isFinite(r.roiSoFar)).toBe(true);
  });

  it("empty events → zeros, paidForItself false, no NaN", () => {
    const r = computeRoi([], { now: NOW, priceUsd: PRO_PRICE_USD_PER_MONTH });
    expect(r.savedSoFar.tokens).toBe(0);
    expect(r.roiSoFar).toBe(0);
    expect(r.roiProjected).toBe(0);
    expect(r.paidForItself).toBe(false);
    expect(Number.isNaN(r.roiProjected)).toBe(false);
  });

  it("exports the canonical site price", () => {
    expect(PRO_PRICE_USD_PER_MONTH).toBe(7.99);
  });
});
