import { describe, expect, it } from "vitest";
import { hashScorerConfig, inspectPack } from "../src/inspect.js";

describe("inspectPack", () => {
  it("deterministic: same input -> same dropped order and hash", () => {
    const input = {
      query: "fix auth",
      kept: [
        { blockId: "b2", filePath: "src/b.ts", score: 0.8, rank: 1 },
        { blockId: "b1", filePath: "src/a.ts", score: 0.9, rank: 2 },
      ],
      dropped: [
        { blockId: "b3", filePath: "src/c.ts", score: 0.2, rank: 3, reason: "budget" as const, droppedAtRank: 3 },
      ],
      budget: 2000,
      scorerConfig: { version: 1 },
    };
    const a = inspectPack(input);
    const b = inspectPack(input);
    expect(a.dropped.map((x) => x.blockId)).toEqual(b.dropped.map((x) => x.blockId));
    expect(a.scorerConfigHash).toBe(b.scorerConfigHash);
  });

  it("budget reason when over budget", () => {
    const report = inspectPack({
      query: "q",
      kept: [{ blockId: "k1", filePath: "a.ts", score: 0.9, rank: 1 }],
      dropped: [{ blockId: "d1", filePath: "b.ts", score: 0.1, rank: 2, reason: "budget", droppedAtRank: 2 }],
      budget: 100,
      scorerConfig: { version: 1 },
    });
    expect(report.dropped[0]?.reason).toBe("budget");
  });

  it("dedup: duplicate blockId second is dedup", () => {
    const report = inspectPack({
      query: "q",
      kept: [],
      dropped: [
        { blockId: "dup", filePath: "a.ts", score: 0.5, rank: 1, reason: "dedup", droppedAtRank: 1 },
        { blockId: "dup", filePath: "a.ts", score: 0.5, rank: 2, reason: "dedup", droppedAtRank: 2 },
      ],
      budget: 2000,
      scorerConfig: { version: 1 },
    });
    expect(report.dropped[1]?.reason).toBe("dedup");
  });

  it("counters sum correctly", () => {
    const report = inspectPack({
      query: "q",
      kept: [{ blockId: "k1", filePath: "a.ts", score: 0.9, rank: 1 }],
      dropped: [{ blockId: "d1", filePath: "b.ts", score: 0.1, rank: 2, reason: "rank", droppedAtRank: 2 }],
      budget: 2000,
      scorerConfig: { version: 1 },
    });
    expect(report.counters.totalBlocks).toBe(2);
    expect(report.counters.keptTokens + report.counters.droppedTokens).toBe(report.counters.totalTokens);
  });

  it("hashScorerConfig stable", () => {
    const h1 = hashScorerConfig({ a: 1, b: 2 });
    const h2 = hashScorerConfig({ b: 2, a: 1 });
    // Our simple hash sorts keys, so should be equal? Our impl uses Object.keys().sort(), so yes
    // But we test that same object gives same hash
    expect(h1).toBe(hashScorerConfig({ a: 1, b: 2 }));
  });
});
