import { describe, expect, it } from "vitest";
import { renderHonestReport } from "../../src/commands/audit/honest.js";

describe("renderHonestReport", () => {
  it("renders the four fractions + eligible reduction + the eligible-only caveat", () => {
    const text = renderHonestReport({
      eligibleReduction: 0.91,
      eligibleTokenFraction: 0.62,
      proxiedTokenFraction: 0.7,
      passthroughTokenFraction: 0.2,
      mediatedEligibleFraction: 0.88,
      rawTokensObserved: 100000,
      rawTokensEligible: 62000,
      returnedTokensEligible: 5580,
    });
    expect(text).toContain("eligible reduction");
    expect(text).toContain("91");
    expect(text).toContain("eligible mediated context"); // the honesty caveat
    expect(text).toContain("eligible token fraction");
  });

  it("renders token source line when 100% measured", () => {
    const text = renderHonestReport(
      {
        eligibleReduction: 0.8,
        eligibleTokenFraction: 1,
        proxiedTokenFraction: 1,
        passthroughTokenFraction: 0,
        mediatedEligibleFraction: 1,
        rawTokensObserved: 7500,
        rawTokensEligible: 7500,
        returnedTokensEligible: 1582,
      },
      1,
    );
    expect(text).toContain("token source:              measured (100% of rows)");
  });

  it("renders token source line when partially measured", () => {
    const text = renderHonestReport(
      {
        eligibleReduction: 0.8,
        eligibleTokenFraction: 1,
        proxiedTokenFraction: 1,
        passthroughTokenFraction: 0,
        mediatedEligibleFraction: 1,
        rawTokensObserved: 22500,
        rawTokensEligible: 22500,
        returnedTokensEligible: 4639,
      },
      0.84,
    );
    expect(text).toContain("token source:              84% measured, 16% bytes/4 estimate");
  });
});
