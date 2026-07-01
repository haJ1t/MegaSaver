import { describe, expect, it } from "vitest";
import { proxyUsageSavings, sumBytesSavedSince } from "../src/proxy-usage-savings.js";

const usage = (
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
) => ({ inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens });

describe("proxyUsageSavings", () => {
  it("returns zeros and 0 shares for no usage and no savings", () => {
    const r = proxyUsageSavings({ savedTokens: 0, usage: [] });
    expect(r.savedTokens).toBe(0);
    expect(r.proxyCalls).toBe(0);
    expect(r.newContextTokens).toBe(0);
    expect(r.totalContextTokens).toBe(0);
    expect(r.savedShareOfNewContext).toBe(0);
    expect(r.savedShareOfTotalContext).toBe(0);
  });

  it("newContext excludes cache reads; shares add saved back to actual (no double count)", () => {
    // saved removed 1000; model actually processed 9000 new-context tokens.
    // would-have-been = 9000 + 1000 = 10000 → saved is 10% of what would have gone.
    const r = proxyUsageSavings({ savedTokens: 1000, usage: [usage(9000, 0, 0, 500)] });
    expect(r.newContextTokens).toBe(9000);
    expect(r.totalContextTokens).toBe(9000);
    expect(r.outputTokens).toBe(500); // informational, never in a denominator
    expect(r.savedShareOfNewContext).toBeCloseTo(0.1, 10);
    expect(r.savedShareOfTotalContext).toBeCloseTo(0.1, 10);
    expect(r.reliable).toBe(true); // saved (1000) <= new context (9000)
  });

  it("flags unreliable when saved exceeds new context (partial proxy coverage)", () => {
    // 50k removed but the proxy only measured 1k of new context => the proxy saw
    // a fraction of the workload; any ratio would be a near-100% lie.
    const r = proxyUsageSavings({ savedTokens: 50000, usage: [usage(1000, 0, 0, 100)] });
    expect(r.newContextTokens).toBe(1000);
    expect(r.reliable).toBe(false);
  });

  it("is unreliable when there is no measured new context", () => {
    const r = proxyUsageSavings({ savedTokens: 100, usage: [usage(0, 0, 5000, 0)] });
    expect(r.newContextTokens).toBe(0);
    expect(r.reliable).toBe(false);
  });

  it("cache reads inflate totalContext but not newContext", () => {
    const r = proxyUsageSavings({ savedTokens: 1000, usage: [usage(1000, 0, 90000, 200)] });
    expect(r.newContextTokens).toBe(1000);
    expect(r.totalContextTokens).toBe(91000);
    expect(r.savedShareOfNewContext).toBeCloseTo(1000 / 2000, 10); // 0.5
    expect(r.savedShareOfTotalContext).toBeCloseTo(1000 / 92000, 10);
  });

  it("sumBytesSavedSince windows out events before the cutoff", () => {
    const events = [
      { createdAt: "2026-07-01T08:00:00.000Z", bytesSaved: 100 }, // before
      { createdAt: "2026-07-01T10:00:00.000Z", bytesSaved: 200 }, // at/after
      { createdAt: "2026-07-01T12:00:00.000Z", bytesSaved: 300 }, // after
      { createdAt: "not-a-date", bytesSaved: 999 }, // skipped
    ];
    const cutoff = Date.parse("2026-07-01T10:00:00.000Z");
    expect(sumBytesSavedSince(events, cutoff)).toBe(500); // 200 + 300
    expect(sumBytesSavedSince(events, 0)).toBe(600); // all valid dates
    expect(sumBytesSavedSince([], cutoff)).toBe(0);
  });

  it("sums token fields across all usage rows", () => {
    const r = proxyUsageSavings({
      savedTokens: 500,
      usage: [usage(1000, 200, 3000, 50), usage(2000, 800, 7000, 150)],
    });
    expect(r.proxyCalls).toBe(2);
    expect(r.inputTokens).toBe(3000);
    expect(r.cacheCreationTokens).toBe(1000);
    expect(r.cacheReadTokens).toBe(10000);
    expect(r.outputTokens).toBe(200);
    expect(r.newContextTokens).toBe(4000); // 3000 + 1000
    expect(r.totalContextTokens).toBe(14000); // + 10000
    expect(r.savedShareOfNewContext).toBeCloseTo(500 / 4500, 10);
  });
});
