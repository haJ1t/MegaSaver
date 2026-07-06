import { describe, expect, it } from "vitest";
import {
  INPUT_PRICE_PER_MTOK_USD,
  SAVINGS_FOOTNOTE,
  computeSavingsHeadline,
  formatDollarsSaved,
  savingsFootnote,
  savingsHeadlineFromTokens,
} from "../src/savings-headline.js";

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

describe("savingsHeadlineFromTokens", () => {
  it("prices a saved-token count directly without a byte round-trip", () => {
    const headline = savingsHeadlineFromTokens(4700, 0.67);
    expect(headline.tokensSaved).toBe(4700);
    expect(headline.dollarsSaved).toBe((4700 / 1_000_000) * 3.0);
    expect(headline.contextWindowsReclaimed).toBe(4700 / 200_000);
    expect(headline.savingRatio).toBe(0.67);
    expect(headline.isEstimate).toBe(true);
  });

  it("agrees with computeSavingsHeadline for the same underlying tokens", () => {
    // 4_000_000 bytes / 4 = 1_000_000 tokens; both entries must match.
    const fromBytes = computeSavingsHeadline({
      bytesSavedTotal: 4_000_000,
      sessionsCount: 3,
      savingRatio: 0.5,
    });
    const fromTokens = savingsHeadlineFromTokens(1_000_000, 0.5);
    expect(fromTokens).toEqual(fromBytes);
  });
});

describe("formatDollarsSaved", () => {
  it("floors the half-cent so the public $ never overstates", () => {
    // 37.035 rounds UP to "$37.04" under toFixed(2); the conservative display
    // must floor the cents to "$37.03" and never overstate the shared number.
    expect(formatDollarsSaved(37.035)).toBe("$37.03");
  });

  it("keeps exact cent values unchanged", () => {
    expect(formatDollarsSaved(12.4)).toBe("$12.40");
  });

  it("renders zero as $0.00", () => {
    expect(formatDollarsSaved(0)).toBe("$0.00");
  });
});

describe("savings footnote", () => {
  it("embeds the current price constant, not a hardcoded literal", () => {
    // Proves the displayed price is derived from INPUT_PRICE_PER_MTOK_USD:
    // change the const and the footnote follows.
    expect(SAVINGS_FOOTNOTE).toContain(`$${INPUT_PRICE_PER_MTOK_USD}/M`);
  });

  it("reformats the price so a different constant renders a different price", () => {
    // If the const were bumped to 5, the footnote must say $5/M — not $3/M.
    expect(savingsFootnote(5)).toContain("$5/M");
    expect(savingsFootnote(5)).not.toContain("$3/M");
    expect(savingsFootnote(3)).toContain("$3/M");
  });
});
