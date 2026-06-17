import { estimateTokens } from "@megasaver/output-filter";
import { describe, expect, it } from "vitest";
import {
  type HonestObservation,
  aggregateHonestMetrics,
  classifyObservation,
  eligibilityClassSchema,
  honestObservationSchema,
  mediationKindSchema,
  meetsGaGate,
  meetsGaGateFromCorpus,
  observationsFromEvents,
  recordedEventsFromLogs,
} from "../src/honest-metrics.js";
import { computeSufficiencyMetrics } from "../src/sufficiency-metrics.js";

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
      obs({
        rawTokens: 1000,
        returnedTokens: 1000,
        eligibility: "passthrough",
        mediation: "native",
      }),
      obs({
        rawTokens: 1000,
        returnedTokens: 1000,
        eligibility: "native_observed",
        mediation: "native",
      }),
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
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 500, returnedTokens: 500, eligibility: "passthrough", mediation: "native" }),
    ]);
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

describe("meetsGaGate", () => {
  const targets = { reductionTarget: 0.9, sufficiencyTarget: 0.95 };
  it("passes only when BOTH reduction and sufficiency clear their targets", () => {
    expect(
      meetsGaGate({ eligibleReduction: 0.92, actionabilityFixturePassRate: 0.96 }, targets),
    ).toMatchObject({
      pass: true,
    });
  });
  it("fails when reduction clears but sufficiency does not (cannot trade evidence for tokens)", () => {
    const r = meetsGaGate({ eligibleReduction: 0.99, actionabilityFixturePassRate: 0.5 }, targets);
    expect(r.pass).toBe(false);
    expect(r.failed).toContain("sufficiency");
  });
  it("fails when sufficiency clears but reduction does not", () => {
    const r = meetsGaGate({ eligibleReduction: 0.7, actionabilityFixturePassRate: 0.99 }, targets);
    expect(r.pass).toBe(false);
    expect(r.failed).toContain("reduction");
  });
});

describe("classifyObservation", () => {
  it("compressed mediated output above threshold is eligible", () => {
    expect(
      classifyObservation({
        decision: "compressed",
        rawTokens: 5000,
        returnedTokens: 400,
        mediation: "proxy",
      }),
    ).toEqual({
      rawTokens: 5000,
      returnedTokens: 400,
      eligibility: "eligible",
      mediation: "proxy",
    });
  });

  it("passthrough output is passthrough with returned==raw (no fake savings)", () => {
    expect(
      classifyObservation({
        decision: "passthrough",
        rawTokens: 300,
        returnedTokens: 300,
        mediation: "saver_hook",
      }),
    ).toEqual({
      rawTokens: 300,
      returnedTokens: 300,
      eligibility: "passthrough",
      mediation: "saver_hook",
    });
  });

  it("light decision is treated as passthrough for eligibility (not counted as savings)", () => {
    expect(
      classifyObservation({
        decision: "light",
        rawTokens: 1500,
        returnedTokens: 1400,
        mediation: "proxy",
      }).eligibility,
    ).toBe("passthrough");
  });

  it("native-observed output (from hook log, no mediation) is native_observed + native", () => {
    expect(
      classifyObservation({
        decision: "compressed",
        rawTokens: 9000,
        returnedTokens: 9000,
        mediation: "native",
      }),
    ).toEqual({
      rawTokens: 9000,
      returnedTokens: 9000,
      eligibility: "native_observed",
      mediation: "native",
    });
  });
});

describe("observationsFromEvents token count is pinned to estimateTokens", () => {
  it("converts recorded byte counts to the same tokens estimateTokens gives the byte-equivalent string", () => {
    // A string of N single-byte chars has N utf8 bytes, so a recorded event with
    // rawBytes=N must yield estimateTokens(that string) tokens. This pins the
    // production pipeline's token model to estimateTokens, not a restated formula.
    const rawContent = "a".repeat(123);
    const returnedContent = "a".repeat(40);
    const [observation] = observationsFromEvents([
      {
        rawBytes: Buffer.byteLength(rawContent, "utf8"),
        returnedBytes: Buffer.byteLength(returnedContent, "utf8"),
        mediation: "proxy",
        decision: "compressed",
      },
    ]);
    expect(observation?.rawTokens).toBe(estimateTokens(rawContent));
    expect(observation?.returnedTokens).toBe(estimateTokens(returnedContent));
  });
});

describe("recordedEventsFromLogs (mediation assigned by log source)", () => {
  it("tags overlay events saver_hook, session events proxy, hook-log native", () => {
    const recorded = recordedEventsFromLogs({
      overlayEvents: [{ rawBytes: 8000, returnedBytes: 400 }],
      sessionEvents: [{ rawBytes: 6000, returnedBytes: 300 }],
      nativeEligible: [{ rawBytes: 12000 }],
    });
    expect(recorded).toContainEqual({
      rawBytes: 8000,
      returnedBytes: 400,
      mediation: "saver_hook",
      decision: "compressed",
    });
    expect(recorded).toContainEqual({
      rawBytes: 6000,
      returnedBytes: 300,
      mediation: "proxy",
      decision: "compressed",
    });
    expect(recorded).toContainEqual({
      rawBytes: 12000,
      returnedBytes: 12000,
      mediation: "native",
      decision: "compressed",
    });
  });
});

describe("meetsGaGate — corpus-computed overload", () => {
  const targets = { reductionTarget: 0.9, sufficiencyTarget: 0.95 };

  it("accepts pre-computed scalar (existing API unchanged)", () => {
    expect(
      meetsGaGate({ eligibleReduction: 0.92, actionabilityFixturePassRate: 0.96 }, targets),
    ).toMatchObject({ pass: true });
  });

  it("accepts GaGateFromCorpus and computes actionabilityFixturePassRate internally", () => {
    const sufficiency = computeSufficiencyMetrics({
      expandedCount: 1,
      totalCompressedResponses: 5,
      expansionsWithUsefulResult: 1,
      compressedOutputFor: (f) => f.compressedContent, // identity — corpus passes
      secretBlockCount: 0,
      totalEligibleCount: 10,
    });
    // The corpus is designed so compressedContent retains nextAction → pass rate = 1
    const result = meetsGaGateFromCorpus(
      { eligibleReduction: 0.92, sufficiencyMetrics: sufficiency },
      targets,
    );
    expect(result.pass).toBe(true);
  });

  it("fails sufficiency when actionabilityFixturePassRate from corpus is below target", () => {
    const sufficiency = computeSufficiencyMetrics({
      expandedCount: 0,
      totalCompressedResponses: 0,
      expansionsWithUsefulResult: 0,
      compressedOutputFor: () => "", // nothing retained → pass rate = 0
      secretBlockCount: 0,
      totalEligibleCount: 0,
    });
    const result = meetsGaGateFromCorpus(
      { eligibleReduction: 0.92, sufficiencyMetrics: sufficiency },
      targets,
    );
    expect(result.pass).toBe(false);
    expect(result.failed).toContain("sufficiency");
  });
});

describe("observationsFromEvents", () => {
  it("turns recorded events into eligible/native observations using bytes/4 tokens", () => {
    const observations = observationsFromEvents([
      // rawBytes 8000 -> 2000 tokens; returnedBytes 400 -> 100 tokens
      { rawBytes: 8000, returnedBytes: 400, mediation: "saver_hook", decision: "compressed" },
      { rawBytes: 12000, returnedBytes: 12000, mediation: "native", decision: "compressed" },
    ]);
    expect(observations).toContainEqual({
      rawTokens: 2000,
      returnedTokens: 100,
      eligibility: "eligible",
      mediation: "saver_hook",
    });
    expect(observations).toContainEqual({
      rawTokens: 3000,
      returnedTokens: 3000,
      eligibility: "native_observed",
      mediation: "native",
    });
  });

  it("a non-compressed recorded event is NOT eligible (no fake savings)", () => {
    const [obs] = observationsFromEvents([
      { rawBytes: 4000, returnedBytes: 4000, mediation: "proxy", decision: "passthrough" },
    ]);
    expect(obs?.eligibility).toBe("passthrough");
    expect(obs?.returnedTokens).toBe(obs?.rawTokens);
  });
});
