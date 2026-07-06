import { describe, expect, it } from "vitest";
import { forecastSavings } from "../src/forecast.js";

// tokensFromBytes is bytes/4 (see @megasaver/stats); 4_000_000 bytes → 1_000_000 tokens.
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

describe("forecastSavings — month", () => {
  it("sums in-period savings and projects by run-rate", () => {
    const events = [
      ev("2026-07-05T00:00:00.000Z", 4_000_000, 0), // in period → 1_000_000 tokens
      ev("2026-07-10T00:00:00.000Z", 4_000_000, 1), // in period → 1_000_000 tokens
      ev("2026-06-30T00:00:00.000Z", 20_000_000, 2), // before periodStart → excluded
      ev("2026-07-20T00:00:00.000Z", 40_000_000, 3), // after now → excluded
    ];
    const f = forecastSavings(events, { now: NOW, period: "month" });
    expect(f.period).toBe("month");
    expect(f.savedSoFar.bytes).toBe(8_000_000);
    expect(f.savedSoFar.tokens).toBe(2_000_000);
    expect(f.elapsedDays).toBeCloseTo(14);
    expect(f.totalDays).toBeCloseTo(31);
    expect(f.daysLeft).toBeCloseTo(17);
    // run-rate: 2_000_000 tokens over 14 days → × 31/14 at month end.
    expect(f.projectedEnd.tokens).toBeCloseTo(2_000_000 * (31 / 14));
    expect(Number.isFinite(f.projectedEnd.dollars)).toBe(true);
  });

  it("elapsedMs<=0 (now === periodStart) → projectedEnd == savedSoFar, no NaN", () => {
    const start = Date.UTC(2026, 6, 1, 0, 0, 0);
    const events = [ev("2026-07-01T00:00:00.000Z", 4_000_000, 0)]; // exactly at periodStart, included
    const f = forecastSavings(events, { now: start, period: "month" });
    expect(f.savedSoFar.tokens).toBe(1_000_000);
    expect(f.projectedEnd.tokens).toBe(f.savedSoFar.tokens);
    expect(f.dailyRate.tokens).toBe(0);
    expect(Number.isNaN(f.projectedEnd.tokens)).toBe(false);
  });

  it("empty events → zeros, no NaN", () => {
    const f = forecastSavings([], { now: NOW, period: "month" });
    expect(f.savedSoFar.tokens).toBe(0);
    expect(f.projectedEnd.tokens).toBe(0);
    expect(Number.isNaN(f.projectedEnd.dollars)).toBe(false);
  });
});

describe("forecastSavings — week", () => {
  it("uses a Monday-based window and excludes out-of-week events", () => {
    // 2026-07-15 is a Wednesday; the ISO week starts Monday 2026-07-13T00:00Z.
    const events = [
      ev("2026-07-13T06:00:00.000Z", 4_000_000, 0), // Monday, in week
      ev("2026-07-14T06:00:00.000Z", 4_000_000, 1), // Tuesday, in week
      ev("2026-07-12T06:00:00.000Z", 40_000_000, 2), // previous Sunday → excluded
    ];
    const f = forecastSavings(events, { now: NOW, period: "week" });
    expect(f.period).toBe("week");
    expect(f.totalDays).toBeCloseTo(7);
    expect(f.savedSoFar.tokens).toBe(2_000_000); // the two in-week events only
    expect(f.projectedEnd.tokens).toBeGreaterThan(f.savedSoFar.tokens);
  });
});
