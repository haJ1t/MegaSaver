import { z } from "zod";

export const eligibilityClassSchema = z.enum(["eligible", "passthrough", "native_observed"]);
export type EligibilityClass = z.infer<typeof eligibilityClassSchema>;

export const mediationKindSchema = z.enum(["proxy", "saver_hook", "native"]);
export type MediationKind = z.infer<typeof mediationKindSchema>;

export const honestObservationSchema = z
  .object({
    rawTokens: z.number().int().nonnegative(),
    returnedTokens: z.number().int().nonnegative(),
    eligibility: eligibilityClassSchema,
    mediation: mediationKindSchema,
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.returnedTokens > o.rawTokens) {
      ctx.addIssue({ code: "custom", message: "returnedTokens must not exceed rawTokens.", path: ["returnedTokens"] });
    }
  });
export type HonestObservation = z.infer<typeof honestObservationSchema>;

export interface GaGateInput {
  eligibleReduction: number;
  actionabilityFixturePassRate: number;
}
export interface GaGateTargets {
  reductionTarget: number;
  sufficiencyTarget: number;
}
export interface GaGateResult {
  pass: boolean;
  failed: readonly ("reduction" | "sufficiency")[];
}

export function meetsGaGate(input: GaGateInput, targets: GaGateTargets): GaGateResult {
  const failed: ("reduction" | "sufficiency")[] = [];
  if (input.eligibleReduction < targets.reductionTarget) failed.push("reduction");
  if (input.actionabilityFixturePassRate < targets.sufficiencyTarget) failed.push("sufficiency");
  return { pass: failed.length === 0, failed };
}

export interface HonestMetrics {
  eligibleReduction: number;
  eligibleTokenFraction: number;
  proxiedTokenFraction: number;
  passthroughTokenFraction: number;
  mediatedEligibleFraction: number;
  rawTokensObserved: number;
  rawTokensEligible: number;
  returnedTokensEligible: number;
}

const safeRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

export function aggregateHonestMetrics(observations: readonly HonestObservation[]): HonestMetrics {
  let rawObserved = 0;
  let rawEligible = 0;
  let returnedEligible = 0;
  let rawProxied = 0;
  let rawPassthrough = 0;
  let rawEligibleMediated = 0;
  for (const o of observations) {
    rawObserved += o.rawTokens;
    if (o.mediation !== "native") rawProxied += o.rawTokens;
    if (o.eligibility === "passthrough") rawPassthrough += o.rawTokens;
    if (o.eligibility === "eligible") {
      rawEligible += o.rawTokens;
      returnedEligible += o.returnedTokens;
      if (o.mediation !== "native") rawEligibleMediated += o.rawTokens;
    }
  }
  return {
    eligibleReduction: rawEligible === 0 ? 0 : 1 - returnedEligible / rawEligible,
    eligibleTokenFraction: safeRatio(rawEligible, rawObserved),
    proxiedTokenFraction: safeRatio(rawProxied, rawObserved),
    passthroughTokenFraction: safeRatio(rawPassthrough, rawObserved),
    mediatedEligibleFraction: safeRatio(rawEligibleMediated, rawEligible),
    rawTokensObserved: rawObserved,
    rawTokensEligible: rawEligible,
    returnedTokensEligible: returnedEligible,
  };
}
