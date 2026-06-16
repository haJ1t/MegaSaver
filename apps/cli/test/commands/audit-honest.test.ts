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
});
