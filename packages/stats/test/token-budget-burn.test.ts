import { describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  BUDGET_VARIANCE_MIN_SAMPLES,
  BUDGET_VARIANCE_MULTIPLE,
  BUDGET_WARN_RATIO,
  type BudgetAnnouncements,
  evaluateBudget,
  foldMeasuredBurn,
  medianOf,
} from "../src/token-budget-burn.js";

function ev(overrides: Partial<OverlayTokenSaverEvent>): OverlayTokenSaverEvent {
  return {
    id: "ove-1",
    liveSessionId: "live-1",
    workspaceKey: "0a1b2c3d4e5f6071",
    createdAt: "2026-08-06T10:00:00.000+00:00",
    sourceKind: "command",
    label: "vitest run",
    rawBytes: 100_000,
    returnedBytes: 2_000,
    bytesSaved: 98_000,
    savingRatio: 0.98,
    summary: "s",
    ...overrides,
  };
}

const NONE: BudgetAnnouncements = { warn80: false, warn100: false, variance: false };

describe("foldMeasuredBurn", () => {
  it("sums returnedTokens over measured rows and counts unmeasured rows", () => {
    const burn = foldMeasuredBurn([
      ev({ id: "a", returnedTokens: 500 }),
      ev({ id: "b", returnedTokens: 700, kind: "expansion" }),
      ev({ id: "c" }), // no returnedTokens → UNMEASURED, never estimated
    ]);
    expect(burn).toEqual({ burnTokens: 1200, measuredEvents: 2, unmeasuredEvents: 1 });
  });
});

describe("medianOf", () => {
  it("odd length → exact middle; even length → mean of two middles; empty → null", () => {
    expect(medianOf([9, 1, 5])).toBe(5);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
});

describe("evaluateBudget thresholds", () => {
  const limit = { limitTokens: 1000, scope: "task" as const, taskLabel: "refactor-auth" };
  it("below 80% → no lines, announcements unchanged", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 799, measuredEvents: 3, unmeasuredEvents: 0 },
      limit,
      historicalBurns: [],
      announced: NONE,
    });
    expect(r.lines).toEqual([]);
    expect(r.announced).toEqual(NONE);
  });
  it("at exactly 80% → one warn line, warn80 flips, not warn100", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 800, measuredEvents: 3, unmeasuredEvents: 1 },
      limit,
      historicalBurns: [],
      announced: NONE,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("80%");
    expect(r.lines[0]).toContain("refactor-auth");
    expect(r.announced).toEqual({ warn80: true, warn100: false, variance: false });
  });
  it("at 100% with warn80 already announced → only the exceeded line", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 1000, measuredEvents: 4, unmeasuredEvents: 0 },
      limit,
      historicalBurns: [],
      announced: { warn80: true, warn100: false, variance: false },
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("EXCEEDED");
    expect(r.lines[0]).toContain("warn-only");
    expect(r.announced.warn100).toBe(true);
  });
  it("already fully announced → silent forever", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 5000, measuredEvents: 9, unmeasuredEvents: 0 },
      limit,
      historicalBurns: [],
      announced: { warn80: true, warn100: true, variance: false },
    });
    expect(r.lines).toEqual([]);
  });
  it("no limit → threshold lines never fire", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 5000, measuredEvents: 9, unmeasuredEvents: 0 },
      limit: null,
      historicalBurns: [],
      announced: NONE,
    });
    expect(r.lines).toEqual([]);
  });
});

describe("evaluateBudget variance alarm", () => {
  const limit = { limitTokens: 1_000_000, scope: "task" as const, taskLabel: "refactor-auth" };
  it("fires at >= 3x median with >= 3 samples, once", () => {
    expect(BUDGET_VARIANCE_MULTIPLE).toBe(3);
    expect(BUDGET_VARIANCE_MIN_SAMPLES).toBe(3);
    const r = evaluateBudget({
      burn: { burnTokens: 150_000, measuredEvents: 10, unmeasuredEvents: 0 },
      limit,
      historicalBurns: [40_000, 50_000, 48_000],
      announced: NONE,
    });
    expect(r.lines.some((l) => l.includes("variance"))).toBe(true);
    expect(r.announced.variance).toBe(true);
  });
  it("does NOT fire at 2 samples or below 3x", () => {
    for (const historicalBurns of [[40_000, 50_000], [50_000, 50_000, 50_000]]) {
      const burnTokens = historicalBurns.length === 2 ? 150_000 : 149_999;
      const r = evaluateBudget({
        burn: { burnTokens, measuredEvents: 10, unmeasuredEvents: 0 },
        limit,
        historicalBurns,
        announced: NONE,
      });
      expect(r.announced.variance).toBe(false);
    }
  });
  it("BUDGET_WARN_RATIO is 0.8", () => {
    expect(BUDGET_WARN_RATIO).toBe(0.8);
  });
});
