import type { FilterDecision } from "@megasaver/output-filter";
import { z } from "zod";
import type { SufficiencyMetrics } from "./sufficiency-metrics.js";

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
      ctx.addIssue({
        code: "custom",
        message: "returnedTokens must not exceed rawTokens.",
        path: ["returnedTokens"],
      });
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

// Mirror estimateTokens (Math.ceil(bytes/4)) so honest metrics use the same
// token model as the rest of the pipeline. estimateTokens takes a string;
// recorded events only retain byte counts, so apply the identical formula here.
export function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

// A persisted event always records a `compressed` mediated output. `decision`
// and `mediation` are REQUIRED — the loader sets them from the log source
// (overlay→saver_hook, session→saver_hook, hook-telemetry→native); they are
// never read from the row, which does not carry them.
export interface RecordedEventLike {
  rawBytes: number;
  returnedBytes: number;
  mediation: MediationKind;
  decision: FilterDecision;
}

export function observationsFromEvents(
  events: readonly RecordedEventLike[],
): readonly HonestObservation[] {
  return events.map((e) =>
    classifyObservation({
      decision: e.decision,
      rawTokens: tokensFromBytes(e.rawBytes),
      returnedTokens: tokensFromBytes(e.returnedBytes),
      mediation: e.mediation,
    }),
  );
}

// The honest projection from the two on-disk logs + hook telemetry. Mediation
// is assigned by SOURCE, the only place that knows it. Native-eligible outputs
// were observed but never mediated, so returned == raw (no reduction).
export function recordedEventsFromLogs(input: {
  overlayEvents: readonly { rawBytes: number; returnedBytes: number }[];
  sessionEvents: readonly { rawBytes: number; returnedBytes: number }[];
  nativeEligible: readonly { rawBytes: number }[];
}): readonly RecordedEventLike[] {
  return [
    ...input.overlayEvents.map((e) => ({
      ...e,
      mediation: "saver_hook" as const,
      decision: "compressed" as const,
    })),
    ...input.sessionEvents.map((e) => ({
      ...e,
      mediation: "saver_hook" as const,
      decision: "compressed" as const,
    })),
    ...input.nativeEligible.map((n) => ({
      rawBytes: n.rawBytes,
      returnedBytes: n.rawBytes,
      mediation: "native" as const,
      decision: "compressed" as const,
    })),
  ];
}

export interface GaGateFromCorpusInput {
  eligibleReduction: number;
  sufficiencyMetrics: SufficiencyMetrics;
}

/**
 * Overload of meetsGaGate that derives actionabilityFixturePassRate from a
 * SufficiencyMetrics struct produced by computeSufficiencyMetrics, rather
 * than requiring the caller to pass a bare scalar.
 * Existing meetsGaGate(GaGateInput, ...) call sites are unaffected.
 */
export function meetsGaGateFromCorpus(
  input: GaGateFromCorpusInput,
  targets: GaGateTargets,
): GaGateResult {
  return meetsGaGate(
    {
      eligibleReduction: input.eligibleReduction,
      actionabilityFixturePassRate: input.sufficiencyMetrics.actionabilityFixturePassRate,
    },
    targets,
  );
}

export function classifyObservation(input: {
  decision: FilterDecision;
  rawTokens: number;
  returnedTokens: number;
  mediation: MediationKind;
}): HonestObservation {
  // A natively-observed output (hook telemetry only, never mediated by a proxy
  // tool or the saver) is counted as observed-but-not-reduced.
  if (input.mediation === "native") {
    return {
      rawTokens: input.rawTokens,
      returnedTokens: input.rawTokens,
      eligibility: "native_observed",
      mediation: "native",
    };
  }
  // Eligibility relies on the invariant that the filter only emits `decision:
  // "compressed"` for outputs above the large-output threshold (output-filter
  // `tokens.ts`: passthrough < PASSTHROUGH_THRESHOLD_TOKENS=1200, light <
  // HARD_WRAP_THRESHOLD_TOKENS=2000, compressed only >= 2000). So `compressed`
  // implies above-threshold and `eligible` needs no separate threshold check.
  // passthrough/light return (near-)everything and must never count as savings.
  const eligibility: EligibilityClass =
    input.decision === "compressed" ? "eligible" : "passthrough";
  const returnedTokens = eligibility === "eligible" ? input.returnedTokens : input.rawTokens;
  return { rawTokens: input.rawTokens, returnedTokens, eligibility, mediation: input.mediation };
}
