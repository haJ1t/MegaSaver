import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import * as stats from "../src/index.js";
import type {
  GaGateFromCorpusInput,
  HonestMetrics,
  HonestObservation,
  SufficiencyFixture,
  SufficiencyMetrics,
} from "../src/index.js";
import {
  SUFFICIENCY_FIXTURES,
  computeSufficiencyMetrics,
  meetsGaGateFromCorpus,
} from "../src/index.js";

describe("@megasaver/stats honest-metrics public surface type checks", () => {
  it("all honest-metrics functions are exported", () => {
    expectTypeOf(stats.aggregateHonestMetrics).toBeFunction();
    expectTypeOf(stats.classifyObservation).toBeFunction();
    expectTypeOf(stats.meetsGaGate).toBeFunction();
    expectTypeOf(stats.honestObservationSchema).not.toBeNever();
  });

  it("HonestMetrics has eligibleReduction", () => {
    expectTypeOf<HonestMetrics>().toHaveProperty("eligibleReduction");
  });

  it("HonestObservation has eligibility", () => {
    expectTypeOf<HonestObservation>().toHaveProperty("eligibility");
  });
});

describe("@megasaver/stats sufficiency-metrics public surface type checks", () => {
  it("computeSufficiencyMetrics is a function", () => {
    expectTypeOf(computeSufficiencyMetrics).toBeFunction();
  });

  it("meetsGaGateFromCorpus is a function", () => {
    expectTypeOf(meetsGaGateFromCorpus).toBeFunction();
  });

  it("SUFFICIENCY_FIXTURES is readonly array", () => {
    expectTypeOf(SUFFICIENCY_FIXTURES).toMatchTypeOf<readonly SufficiencyFixture[]>();
  });

  it("SufficiencyMetrics has all five fields", () => {
    expectTypeOf<SufficiencyMetrics>().toHaveProperty("expandRate");
    expectTypeOf<SufficiencyMetrics>().toHaveProperty("firstExpansionSuccessRate");
    expectTypeOf<SufficiencyMetrics>().toHaveProperty("failureEvidenceRecall");
    expectTypeOf<SufficiencyMetrics>().toHaveProperty("actionabilityFixturePassRate");
    expectTypeOf<SufficiencyMetrics>().toHaveProperty("secretBlockRate");
  });

  it("GaGateFromCorpusInput has sufficiencyMetrics field", () => {
    expectTypeOf<GaGateFromCorpusInput>().toHaveProperty("sufficiencyMetrics");
  });
});
