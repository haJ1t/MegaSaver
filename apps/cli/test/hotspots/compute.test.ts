import { describe, expect, it } from "vitest";
import { computeHotspots } from "../../src/hotspots/compute.js";

describe("computeHotspots", () => {
  it("large evicted file outranks small kept file", () => {
    const hotspots = computeHotspots({
      blocks: [
        { filePath: "src/large.ts", bytes: 20000 },
        { filePath: "src/small.ts", bytes: 1000 },
      ],
      counters: new Map([
        ["src/large.ts", { kept: 0, dropped: 10 }],
        ["src/small.ts", { kept: 10, dropped: 0 }],
      ]),
    });
    expect(hotspots[0]?.filePath).toBe("src/large.ts");
  });

  it("deterministic tie-break lex", () => {
    const hotspots = computeHotspots({
      blocks: [
        { filePath: "src/b.ts", bytes: 1000 },
        { filePath: "src/a.ts", bytes: 1000 },
      ],
    });
    expect(hotspots[0]?.filePath).toBe("src/a.ts");
  });

  it("100-row trim via slice", () => {
    const blocks = Array.from({ length: 150 }, (_, i) => ({ filePath: `src/f${i}.ts`, bytes: 1000 }));
    const hotspots = computeHotspots({ blocks });
    expect(hotspots.slice(0, 100)).toHaveLength(100);
  });
});
