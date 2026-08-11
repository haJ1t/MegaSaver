import { describe, expect, it } from "vitest";
import { computeHotspots } from "../../src/hotspots/compute.js";

describe("hotspots", () => {
  it("top is largest", () => {
    const res = computeHotspots({
      blocks: [
        { filePath: "a.ts", bytes: 100 },
        { filePath: "b.ts", bytes: 1000 },
      ],
    });
    expect(res[0]?.filePath).toBe("b.ts");
  });
});
