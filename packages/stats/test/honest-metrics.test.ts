import { describe, expect, it } from "vitest";
import {
  aggregateHonestMetrics,
  eligibilityClassSchema,
  honestObservationSchema,
  mediationKindSchema,
  type HonestObservation,
} from "../src/honest-metrics.js";

const obs = (o: Partial<HonestObservation>): HonestObservation => ({
  rawTokens: 1000,
  returnedTokens: 100,
  eligibility: "eligible",
  mediation: "proxy",
  ...o,
});

describe("aggregateHonestMetrics", () => {
  it("computes token-weighted eligible reduction (Sigma/Sigma, not per-output mean)", () => {
    // Two eligible outputs: (10000->100) and (1000->900). Per-output mean would be
    // (0.99 + 0.10)/2 = 0.545; token-weighted is 1 - (1000/11000) = 0.909.
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 10000, returnedTokens: 100 }),
      obs({ rawTokens: 1000, returnedTokens: 900 }),
    ]);
    expect(m.eligibleReduction).toBeCloseTo(0.909, 3);
  });

  it("reports eligible / proxied / passthrough fractions of total observed tokens", () => {
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 8000, eligibility: "eligible", mediation: "proxy" }),
      obs({ rawTokens: 1000, returnedTokens: 1000, eligibility: "passthrough", mediation: "native" }),
      obs({ rawTokens: 1000, returnedTokens: 1000, eligibility: "native_observed", mediation: "native" }),
    ]);
    expect(m.rawTokensObserved).toBe(10000);
    expect(m.eligibleTokenFraction).toBeCloseTo(0.8, 5);
    expect(m.passthroughTokenFraction).toBeCloseTo(0.1, 5);
    // proxied = proxy + saver_hook raw tokens / observed
    expect(m.proxiedTokenFraction).toBeCloseTo(0.8, 5);
  });

  it("mediatedEligibleFraction is eligible-mediated raw over all eligible raw", () => {
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 6000, eligibility: "eligible", mediation: "proxy" }),
      obs({ rawTokens: 2000, eligibility: "eligible", mediation: "saver_hook" }),
      // an eligible output that was observed natively (not mediated) — drags the fraction down
      obs({ rawTokens: 2000, returnedTokens: 2000, eligibility: "eligible", mediation: "native" }),
    ]);
    expect(m.mediatedEligibleFraction).toBeCloseTo(0.8, 5); // 8000/10000
  });

  it("returns a defined zero block with no divide-by-zero on empty input", () => {
    const m = aggregateHonestMetrics([]);
    expect(m).toMatchObject({
      eligibleReduction: 0,
      eligibleTokenFraction: 0,
      proxiedTokenFraction: 0,
      passthroughTokenFraction: 0,
      mediatedEligibleFraction: 0,
      rawTokensObserved: 0,
      rawTokensEligible: 0,
      returnedTokensEligible: 0,
    });
  });

  it("passthrough cannot create positive savings: a passthrough-only set has reduction 0", () => {
    const m = aggregateHonestMetrics([obs({ rawTokens: 500, returnedTokens: 500, eligibility: "passthrough", mediation: "native" })]);
    expect(m.eligibleReduction).toBe(0);
    expect(m.rawTokensEligible).toBe(0);
  });
});

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
