import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import * as stats from "../src/index.js";
import type { HonestMetrics, HonestObservation } from "../src/index.js";

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
