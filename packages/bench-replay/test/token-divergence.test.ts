import { describe, expect, it } from "vitest";
import { measureTokenDivergence } from "../src/token-divergence.js";

describe("measureTokenDivergence", () => {
  it("computes per-corpus ratios from the injected counters", async () => {
    const report = await measureTokenDivergence(
      [
        { name: "a", text: "xxxx" }, // 4 bytes
        { name: "b", text: "yyyyyyyy" }, // 8 bytes
      ],
      {
        estimate: (t) => Math.ceil(Buffer.byteLength(t, "utf8") / 4),
        count: async (t) => Buffer.byteLength(t, "utf8") / 2,
      },
    );
    expect(report.samples).toEqual([
      { name: "a", bytes: 4, estimatedTokens: 1, realTokens: 2, realOverEstimate: 2 },
      { name: "b", bytes: 8, estimatedTokens: 2, realTokens: 4, realOverEstimate: 2 },
    ]);
    expect(report.overallRealOverEstimate).toBe(2);
    expect(report.encoding).toBe("cl100k_base");
  });

  it("smoke: real tokenizer runs through the default counters", async () => {
    const report = await measureTokenDivergence([{ name: "ascii", text: "hello world" }]);
    expect(report.samples[0]?.realTokens).toBe(2);
    expect(report.samples[0]?.estimatedTokens).toBe(3);
  });
});
