// Real-Time Cache Churn Analyzer Unit Tests
import { describe, expect, it } from "vitest";
import { analyzeCacheChurn } from "../src/cache-churn.js";
import type { TokenSaverEvent } from "../src/event.js";

function evt(overrides: Partial<TokenSaverEvent> & { id: string }): TokenSaverEvent {
  return {
    sessionId: "s1",
    workspaceKey: "w1",
    createdAt: "2026-08-10T10:00:00.000Z",
    sourceKind: "Bash",
    label: "rg",
    rawBytes: overrides.rawBytes ?? 1000,
    returnedBytes: overrides.returnedBytes ?? 200,
    bytesSaved: overrides.bytesSaved ?? 800,
    savingRatio: overrides.savingRatio ?? 0.8,
    id: overrides.id,
    summary: "x",
    ...overrides,
  } as TokenSaverEvent;
}

describe("analyzeCacheChurn", () => {
  it("returns zero metrics and keep_enabled recommendation for empty events array", () => {
    const result = analyzeCacheChurn([]);
    expect(result.netSavingsUsd).toBe(0);
    expect(result.cacheInvalidationRate).toBe(0);
    expect(result.recommendation).toBe("keep_enabled");
  });

  it("calculates positive net savings when compression savings outweigh estimated cache churn", () => {
    const event: TokenSaverEvent = {
      id: "evt-1",
      sessionId: "s1",
      workspaceKey: "w1",
      createdAt: "2026-08-10T10:00:00Z",
      sourceKind: "Bash",
      rawBytes: 10000,
      returnedBytes: 2000,
      bytesSaved: 8000,
      savingRatio: 0.8,
    };
    const result = analyzeCacheChurn([event]);
    expect(result.netSavingsUsd).toBeGreaterThan(0);
    expect(result.recommendation).toBe("keep_enabled");
  });

  it("recommends bypass when all events churned and avg saving ratio < 0.2", () => {
    const events: TokenSaverEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `evt-${i}`,
      sessionId: "s1",
      workspaceKey: "w1",
      createdAt: "2026-08-10T10:00:00Z",
      sourceKind: "Bash",
      rawBytes: 500,
      returnedBytes: 450,
      bytesSaved: 50,
      savingRatio: 0.1,
    }));

    const result = analyzeCacheChurn(events);
    // All 10 savingRatio < 0.2 => rate 1.0 > 0.5 and avgSavingRatio 0.1 < 0.2 => bypass_compression (canonical table)
    expect(result.recommendation).toBe("bypass_compression");
  });
});

describe("analyzeCacheChurn — canonical gap closure", () => {
  it("computes real cacheInvalidationRate not 0.05/0.8 constants", () => {
    // 10 events: 6 with low savingRatio (<0.2) => 0.6 rate, should be 0.6 not 0.05
    const events = [
      ...Array.from({ length: 6 }, (_, i) =>
        evt({ id: `e${i}`, savingRatio: 0.1, rawBytes: 500, bytesSaved: 50, returnedBytes: 450 }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        evt({
          id: `f${i}`,
          savingRatio: 0.9,
          rawBytes: 10000,
          bytesSaved: 8000,
          returnedBytes: 2000,
        }),
      ),
    ];
    const r = analyzeCacheChurn(events);
    expect(r.cacheInvalidationRate).toBeCloseTo(0.6, 2);
    expect(r.cacheInvalidationRate).not.toBe(0.05);
    expect(r.cacheInvalidationRate).not.toBe(0.8);
  });

  it("uses deltaTokens sum when present instead of bytes/4", () => {
    const events = [
      evt({ id: "a", bytesSaved: 8000, savingRatio: 0.8, deltaTokens: 100 }),
      evt({ id: "b", bytesSaved: 8000, savingRatio: 0.8, deltaTokens: 200 }),
    ];
    const r = analyzeCacheChurn(events, { pricePerMTokUsd: 3.0 });
    // 300 tokens * 3.0/1e6 = 0.0009
    expect(r.netSavingsUsd).toBeCloseTo(0.0009, 6);
    expect(r.estimatedSavedTokens).toBe(300);
  });

  it("applies bypass_compression threshold (>0.5 invalidated && avgSavingRatio<0.2)", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      evt({ id: `x${i}`, savingRatio: 0.05, rawBytes: 500, bytesSaved: 10, returnedBytes: 490 }),
    );
    const r = analyzeCacheChurn(events);
    expect(r.cacheInvalidationRate).toBeGreaterThan(0.5);
    expect(r.recommendation).toBe("bypass_compression");
  });

  it("applies increase_floor threshold (>0.3 invalidated && len>=5 && not bypass)", () => {
    const events = [
      ...Array.from({ length: 4 }, (_, i) =>
        evt({ id: `l${i}`, savingRatio: 0.1, rawBytes: 500, bytesSaved: 50, returnedBytes: 450 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        evt({
          id: `h${i}`,
          savingRatio: 0.9,
          rawBytes: 10000,
          bytesSaved: 8000,
          returnedBytes: 2000,
        }),
      ),
    ];
    const r = analyzeCacheChurn(events);
    expect(r.cacheInvalidationRate).toBe(0.4);
    expect(r.recommendation).toBe("increase_floor");
  });

  it("empty guard returns zero rate keep_enabled", () => {
    const r = analyzeCacheChurn([]);
    expect(r).toEqual(
      expect.objectContaining({
        cacheInvalidationRate: 0,
        netSavingsUsd: 0,
        recommendation: "keep_enabled",
        totalEvents: 0,
      }),
    );
  });
});
