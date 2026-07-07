import { describe, expect, it } from "vitest";
import { composeCompressionReport, renderCompressionSummary } from "../src/compress-file.js";

describe("composeCompressionReport", () => {
  it("counts markers and computes byte/token/dollar savings", () => {
    const original = "x".repeat(400);
    const compressed = "# H\n… [3 paragraphs]\n… [5 more items]";
    const r = composeCompressionReport(original, compressed);
    expect(r.paragraphsCollapsed).toBe(3);
    expect(r.listItemsDropped).toBe(5);
    expect(r.changed).toBe(true);
    expect(r.originalBytes).toBe(400);
    expect(r.compressedBytes).toBe(Buffer.byteLength(compressed, "utf8"));
    expect(r.bytesSaved).toBe(400 - r.compressedBytes);
    expect(r.tokensSaved).toBeGreaterThan(0);
    expect(r.dollarsSaved).toBeCloseTo((r.tokensSaved / 1_000_000) * 3, 10);
  });

  it("reports no change and zero savings for identical strings", () => {
    const r = composeCompressionReport("same", "same");
    expect(r.changed).toBe(false);
    expect(r.bytesSaved).toBe(0);
    expect(r.tokensSaved).toBe(0);
    expect(r.dollarsSaved).toBe(0);
    expect(r.paragraphsCollapsed).toBe(0);
    expect(r.listItemsDropped).toBe(0);
  });

  it("counts singular markers", () => {
    const r = composeCompressionReport("orig-longer-than-out", "… [1 paragraph]\n… [1 more item]");
    expect(r.paragraphsCollapsed).toBe(1);
    expect(r.listItemsDropped).toBe(1);
  });

  it("sums paragraph markers across sections", () => {
    const r = composeCompressionReport("orig", "… [2 paragraphs]\n# H\n… [4 paragraphs]");
    expect(r.paragraphsCollapsed).toBe(6);
  });

  it("prices by utf8 byte length, not char length", () => {
    const original = "héllo…café☕";
    const r = composeCompressionReport(original, "x");
    expect(r.originalBytes).toBeGreaterThan(original.length);
  });
});

describe("renderCompressionSummary", () => {
  it("shows counts, (est.) dollars, and the verbatim note", () => {
    const r = composeCompressionReport("x".repeat(500), "# H\n… [3 paragraphs]");
    const s = renderCompressionSummary(r);
    expect(s).toContain("(est.)");
    expect(s).toContain("Lossy");
    expect(s).toContain("verbatim");
    expect(s).toContain("3 extra paragraph");
  });
});
