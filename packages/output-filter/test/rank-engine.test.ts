import { describe, expect, it } from "vitest";
import {
  type SessionHints,
  applyEngineRanking,
  engineRankingDisabledByEnv,
  resolveEngineRanking,
  resolveEngineRankingDisabled,
  resolveSeamTraceEnabled,
  scoreChunk,
  seamTraceEnabledByEnv,
} from "../src/rank.js";

const chunk = (text: string) => ({ text, startLine: 1, endLine: 1 });

describe("resolveEngineRanking flag (§8.4)", () => {
  it("defaults to off", () => {
    expect(resolveEngineRanking(undefined)).toBe(false);
    expect(resolveEngineRanking("")).toBe(false);
    expect(resolveEngineRanking("false")).toBe(false);
  });
  it("only 'true' (trimmed, case-insensitive) enables it", () => {
    expect(resolveEngineRanking("true")).toBe(true);
    expect(resolveEngineRanking("  TRUE ")).toBe(true);
    expect(resolveEngineRanking("1")).toBe(false);
  });
});

describe("resolveEngineRankingDisabled — A/B kill switch (seam phase 2 P2.6)", () => {
  it("'false', '0', 'off', 'no' (trimmed, case-insensitive) disable", () => {
    expect(resolveEngineRankingDisabled("false")).toBe(true);
    expect(resolveEngineRankingDisabled("  FALSE ")).toBe(true);
    expect(resolveEngineRankingDisabled("0")).toBe(true);
    expect(resolveEngineRankingDisabled(" 0 ")).toBe(true);
    expect(resolveEngineRankingDisabled("off")).toBe(true);
    expect(resolveEngineRankingDisabled("  OFF ")).toBe(true);
    expect(resolveEngineRankingDisabled("no")).toBe(true);
    expect(resolveEngineRankingDisabled(" No ")).toBe(true);
  });
  it("everything else leaves the seam on", () => {
    expect(resolveEngineRankingDisabled(undefined)).toBe(false);
    expect(resolveEngineRankingDisabled("")).toBe(false);
    expect(resolveEngineRankingDisabled("true")).toBe(false);
    expect(resolveEngineRankingDisabled("1")).toBe(false);
    expect(resolveEngineRankingDisabled("garbage")).toBe(false);
  });
  it("engineRankingDisabledByEnv reads MEGASAVER_ENGINE_RANKING", () => {
    expect(engineRankingDisabledByEnv({ MEGASAVER_ENGINE_RANKING: "false" })).toBe(true);
    expect(engineRankingDisabledByEnv({ MEGASAVER_ENGINE_RANKING: "off" })).toBe(true);
    expect(engineRankingDisabledByEnv({ MEGASAVER_ENGINE_RANKING: "true" })).toBe(false);
    expect(engineRankingDisabledByEnv({})).toBe(false);
  });
});

describe("resolveSeamTraceEnabled — trace recording opt-in (fix batch B)", () => {
  it("only 'true' or '1' (trimmed, case-insensitive) enables", () => {
    expect(resolveSeamTraceEnabled("true")).toBe(true);
    expect(resolveSeamTraceEnabled("  TRUE ")).toBe(true);
    expect(resolveSeamTraceEnabled("1")).toBe(true);
    expect(resolveSeamTraceEnabled(" 1 ")).toBe(true);
  });
  it("everything else keeps trace recording off", () => {
    expect(resolveSeamTraceEnabled(undefined)).toBe(false);
    expect(resolveSeamTraceEnabled("")).toBe(false);
    expect(resolveSeamTraceEnabled("false")).toBe(false);
    expect(resolveSeamTraceEnabled("0")).toBe(false);
    expect(resolveSeamTraceEnabled("yes")).toBe(false);
  });
  it("seamTraceEnabledByEnv reads MEGASAVER_SEAM_TRACE", () => {
    expect(seamTraceEnabledByEnv({ MEGASAVER_SEAM_TRACE: "true" })).toBe(true);
    expect(seamTraceEnabledByEnv({ MEGASAVER_SEAM_TRACE: "1" })).toBe(true);
    expect(seamTraceEnabledByEnv({ MEGASAVER_SEAM_TRACE: "false" })).toBe(false);
    expect(seamTraceEnabledByEnv({})).toBe(false);
  });
});

describe("applyEngineRanking (Deliverable 6)", () => {
  const hints: SessionHints = {
    recentMemory: ["useAuthToken"],
    recentFailures: ["TS2322"],
  };

  it("normalizes base relevance and all signals into [0,1]", () => {
    const ranked = [
      scoreChunk("auth", chunk("Error: useAuthToken failed with TS2322"), hints),
      scoreChunk("auth", chunk("just some plain noise"), hints),
    ];
    const engine = applyEngineRanking(ranked, hints);
    for (const c of engine) {
      const e = c.engine;
      expect(e).toBeDefined();
      if (e === undefined) continue;
      for (const v of [e.baseRelevance, e.memoryBoost, e.failureHistoryBoost, e.finalScore]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("uses the 0.70/0.15/0.15 weighting", () => {
    const ranked = [scoreChunk("auth", chunk("useAuthToken broke at TS2322"), hints)];
    const [c] = applyEngineRanking(ranked, hints);
    const e = c?.engine;
    expect(e).toBeDefined();
    if (e === undefined) return;
    const expected = 0.7 * e.baseRelevance + 0.15 * e.memoryBoost + 0.15 * e.failureHistoryBoost;
    expect(c?.score).toBeCloseTo(expected, 6);
    expect(c?.score).toBeCloseTo(e.finalScore, 6);
  });

  it("memory boost lifts a chunk that references project memory", () => {
    const withMem = applyEngineRanking(
      [scoreChunk("x", chunk("calls useAuthToken here"), hints)],
      hints,
    );
    const withoutMem = applyEngineRanking(
      [scoreChunk("x", chunk("calls something else here"), hints)],
      hints,
    );
    expect(withMem[0]?.engine?.memoryBoost ?? 0).toBeGreaterThan(
      withoutMem[0]?.engine?.memoryBoost ?? 0,
    );
  });

  it("failure-history boost lifts a chunk matching a known failure", () => {
    const hit = applyEngineRanking([scoreChunk("x", chunk("error TS2322 again"), hints)], hints);
    expect(hit[0]?.engine?.failureHistoryBoost ?? 0).toBeGreaterThan(0);
  });

  it("contributes an explanation per chunk for replay/audit", () => {
    const ranked = [scoreChunk("x", chunk("anything"), hints)];
    const [c] = applyEngineRanking(ranked, hints);
    expect(c?.engine).toMatchObject({
      baseRelevance: expect.any(Number),
      memoryBoost: expect.any(Number),
      failureHistoryBoost: expect.any(Number),
      finalScore: expect.any(Number),
    });
  });
});
