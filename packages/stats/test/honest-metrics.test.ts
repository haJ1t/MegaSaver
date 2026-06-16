import { describe, expect, it } from "vitest";
import {
  eligibilityClassSchema,
  honestObservationSchema,
  mediationKindSchema,
} from "../src/honest-metrics.js";

describe("honest-metrics enums + observation", () => {
  it("eligibilityClass accepts the three classes", () => {
    for (const c of ["eligible", "passthrough", "native_observed"]) {
      expect(eligibilityClassSchema.safeParse(c).success).toBe(true);
    }
    expect(eligibilityClassSchema.safeParse("other").success).toBe(false);
  });

  it("mediationKind accepts proxy/saver_hook/native", () => {
    for (const m of ["proxy", "saver_hook", "native"]) {
      expect(mediationKindSchema.safeParse(m).success).toBe(true);
    }
    expect(mediationKindSchema.safeParse("mcp").success).toBe(false);
  });

  it("observation requires non-negative token counts and a returned<=raw invariant", () => {
    expect(
      honestObservationSchema.safeParse({
        rawTokens: 1000,
        returnedTokens: 100,
        eligibility: "eligible",
        mediation: "proxy",
      }).success,
    ).toBe(true);
    expect(
      honestObservationSchema.safeParse({
        rawTokens: 100,
        returnedTokens: 200,
        eligibility: "eligible",
        mediation: "proxy",
      }).success,
    ).toBe(false);
    expect(
      honestObservationSchema.safeParse({
        rawTokens: -1,
        returnedTokens: 0,
        eligibility: "passthrough",
        mediation: "native",
      }).success,
    ).toBe(false);
  });
});
