import type { SufficiencyFixture } from "./sufficiency-fixtures.js";
import { SUFFICIENCY_FIXTURES } from "./sufficiency-fixtures.js";

export interface SufficiencyMetrics {
  /** proxy_expand_chunk calls / compressed responses (zero-guarded) */
  expandRate: number;
  /** Expansions that returned useful result / total expansions (zero-guarded) */
  firstExpansionSuccessRate: number;
  /** Token-essential recall: fraction of known failure essentials present in
   *  the compressed output across the fixture corpus */
  failureEvidenceRecall: number;
  /** Fraction of actionability fixtures where the next action is identifiable
   *  in the compressed output */
  actionabilityFixturePassRate: number;
  /** Outputs blocked/downgraded due to redaction confidence / total eligible */
  secretBlockRate: number;
}

export interface ComputeSufficiencyInput {
  expandedCount: number;
  totalCompressedResponses: number;
  expansionsWithUsefulResult: number;
  /** Maps a fixture to the compressed output the system produced for it.
   *  For unit tests, pass `(f) => f.compressedContent` (identity).
   *  In production, the caller drives compression and provides the result. */
  compressedOutputFor: (fixture: SufficiencyFixture) => string;
  secretBlockCount: number;
  totalEligibleCount: number;
  /** Optional override; defaults to the shipped SUFFICIENCY_FIXTURES corpus. */
  fixtures?: readonly SufficiencyFixture[];
}

/** Pure — scores per-essential presence; partial recall is allowed. */
export function scoreFailureEvidenceRecall(
  fixtures: readonly SufficiencyFixture[],
  compressedOutputFor: (f: SufficiencyFixture) => string,
): number {
  const failures = fixtures.filter((f) => f.kind === "failure_evidence");
  if (failures.length === 0) return 0;
  let totalEssentials = 0;
  let retainedEssentials = 0;
  for (const fixture of failures) {
    const output = compressedOutputFor(fixture);
    for (const essential of fixture.essentials) {
      totalEssentials += 1;
      if (output.includes(essential)) retainedEssentials += 1;
    }
  }
  return totalEssentials === 0 ? 0 : retainedEssentials / totalEssentials;
}

/** Pure — a fixture passes iff its nextAction substring is in the compressed output. */
export function scoreActionabilityPassRate(
  fixtures: readonly SufficiencyFixture[],
  compressedOutputFor: (f: SufficiencyFixture) => string,
): number {
  const actionable = fixtures.filter(
    (f): f is SufficiencyFixture & { nextAction: string } =>
      f.kind === "actionability" && typeof f.nextAction === "string",
  );
  if (actionable.length === 0) return 0;
  const passed = actionable.filter((f) => compressedOutputFor(f).includes(f.nextAction)).length;
  return passed / actionable.length;
}

/** Pure — zero-guarded ratio. */
export function scoreFirstExpansionSuccessRate(
  expansionsWithUsefulResult: number,
  expandedCount: number,
): number {
  return expandedCount === 0 ? 0 : expansionsWithUsefulResult / expandedCount;
}

export function computeSufficiencyMetrics(input: ComputeSufficiencyInput): SufficiencyMetrics {
  const fixtures = input.fixtures ?? SUFFICIENCY_FIXTURES;
  return {
    expandRate:
      input.totalCompressedResponses === 0
        ? 0
        : input.expandedCount / input.totalCompressedResponses,
    firstExpansionSuccessRate: scoreFirstExpansionSuccessRate(
      input.expansionsWithUsefulResult,
      input.expandedCount,
    ),
    failureEvidenceRecall: scoreFailureEvidenceRecall(fixtures, input.compressedOutputFor),
    actionabilityFixturePassRate: scoreActionabilityPassRate(fixtures, input.compressedOutputFor),
    secretBlockRate:
      input.totalEligibleCount === 0 ? 0 : input.secretBlockCount / input.totalEligibleCount,
  };
}
