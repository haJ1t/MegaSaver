import { inspectPack } from "@megasaver/context-pruner";
import { describe, expect, it } from "vitest";

describe("context why integration", () => {
  it("inspectPack via CLI produces drop report", async () => {
    const report = inspectPack({
      query: "fix auth",
      kept: [{ blockId: "k1", filePath: "src/a.ts", score: 0.9, rank: 1 }],
      dropped: [
        {
          blockId: "d1",
          filePath: "src/b.ts",
          score: 0.2,
          rank: 2,
          reason: "budget",
          droppedAtRank: 2,
        },
      ],
      budget: 2000,
      scorerConfig: { version: 1 },
    });
    expect(report.kept).toHaveLength(1);
    expect(report.dropped[0]?.reason).toBe("budget");
    expect(report.scorerConfigHash).toHaveLength(16);
  });
});
