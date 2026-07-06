import { describe, expect, it } from "vitest";
import { computeSavingsHeadline } from "../src/savings-headline.js";

describe("computeSavingsHeadline", () => {
  it("derives tokens, dollars, and reclaimed context windows from saved bytes", () => {
    const headline = computeSavingsHeadline({
      bytesSavedTotal: 4_000_000,
      sessionsCount: 10,
      savingRatio: 0.4,
    });

    // 4_000_000 bytes / 4 = 1_000_000 tokens.
    expect(headline.tokensSaved).toBe(1_000_000);
    // 1_000_000 / 1e6 * $3.0 = $3.00.
    expect(headline.dollarsSaved).toBe(3.0);
    // 1_000_000 / 200_000 = 5 sessions' worth.
    expect(headline.contextWindowsReclaimed).toBe(5);
    expect(headline.savingRatio).toBe(0.4);
    expect(headline.isEstimate).toBe(true);
  });

  it("honors a custom input price per million tokens", () => {
    const headline = computeSavingsHeadline(
      { bytesSavedTotal: 4_000_000, sessionsCount: 10, savingRatio: 0.4 },
      { inputPricePerMTok: 15 },
    );
    expect(headline.dollarsSaved).toBe(15);
  });

  it("returns all zeros but still flags estimate for zero totals", () => {
    const headline = computeSavingsHeadline({
      bytesSavedTotal: 0,
      sessionsCount: 0,
      savingRatio: 0,
    });
    expect(headline.tokensSaved).toBe(0);
    expect(headline.dollarsSaved).toBe(0);
    expect(headline.contextWindowsReclaimed).toBe(0);
    expect(headline.savingRatio).toBe(0);
    expect(headline.isEstimate).toBe(true);
  });
});
