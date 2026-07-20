import type {
  ArmIntegrity,
  ArmUsage,
  DriftSmokeResult,
  OrderCheck,
  PairResult,
  ReplayVerdict,
  TransformSummary,
} from "./types.js";

export function costRatioOf(baseline: ArmUsage, megasaver: ArmUsage): number {
  return megasaver.normalizedCostUsd === 0
    ? Number.POSITIVE_INFINITY
    : baseline.normalizedCostUsd / megasaver.normalizedCostUsd;
}

// The guard that watches the only part of this harness that can fail: the
// transform. It runs once for the whole gate, so this single check covers every
// pair — no arm run can quietly measure a different one. `applied > 0` only
// proves the hook returned SOMETHING; a transform that handed back the same
// bytes is as meaningless as an inert one, and its costRatio ≈ 1.00 reads as a
// healthy "no effect" result.
export function checkTransformIntegrity(transform: TransformSummary): ArmIntegrity {
  const { original, transformed } = transform.bytes;
  return {
    applied: transform.saver.applied,
    originalBytes: original,
    transformedBytes: transformed,
    byteRatio: original === 0 ? Number.NaN : transformed / original,
    ok: transform.saver.applied > 0 && original > 0 && transformed < original,
  };
}

// Below this the check would claim a precision it structurally cannot have: the
// reference is a DIFFERENT agent conversation with a different turn count, so
// two runs agreeing inside a few percent is coincidence, not agreement. A caller
// who asks for a tight band is misunderstanding the instrument, so we refuse
// rather than hand back a `true` that will be quoted as calibration.
export const MIN_DRIFT_SMOKE_TOLERANCE = 0.1;

// NOT a calibration. This is a gross-drift smoke check on the BASELINE arm —
// order-of-magnitude only. It compares a replayed baseline against a real
// end-to-end baseline captured from a different conversation, so it can catch a
// stale recording or a broken cost model and nothing finer. It CANNOT vouch for
// the ≤5% effect this harness exists to resolve and must never be read as
// doing so; `checkArmIntegrity` is the guard that protects the measurement.
export function baselineDriftSmokeOk(input: {
  replayedBaselineUsd: number;
  realBaselineUsd: number;
  tolerance: number;
}): boolean {
  if (input.tolerance < MIN_DRIFT_SMOKE_TOLERANCE) {
    throw new Error(
      `baselineDriftSmokeOk: tolerance ${input.tolerance} is below the ${MIN_DRIFT_SMOKE_TOLERANCE} floor — this is a gross-drift smoke check against a different conversation, not a calibration, and cannot resolve a band that tight`,
    );
  }
  if (!(input.realBaselineUsd > 0)) return false;
  const drift = Math.abs(input.replayedBaselineUsd - input.realBaselineUsd) / input.realBaselineUsd;
  return drift <= input.tolerance;
}

// The ONLY constructor of a ReplayVerdict, so the refusals below cannot be
// skipped by a caller. Checks the caller did not run are recorded as null —
// never as passed. `transform` is the ONE saver pass both pairs replayed, so
// the integrity refusal below necessarily covers whatever the reported ratio
// was derived from.
export function buildVerdict(
  task: string,
  pairs: readonly PairResult[],
  transform: TransformSummary,
  checks?: { order?: OrderCheck; baselineDriftSmoke?: DriftSmokeResult },
): ReplayVerdict {
  const first = pairs[0];
  if (first === undefined) {
    throw new Error(`buildVerdict(${task}): no pair was replayed, so there is no ratio to report`);
  }
  // A multi-pair run's number is the order check's combination of them. Without
  // that check there is no defensible way to collapse several pairs into one
  // ratio, and quoting any single pair's would be reporting a number the shown
  // arms do not account for.
  if (checks?.order === undefined && pairs.length > 1) {
    throw new Error(
      `buildVerdict(${task}): ${pairs.length} pairs were replayed but no order check combined them — there is no single ratio these arms justify`,
    );
  }
  if (transform.saver.applied === 0) {
    throw new Error(
      `buildVerdict(${task}): the megasaver arm applied the saver 0 times (passthrough=${transform.saver.passthrough}, failed=${transform.saver.failed}) — it is identical to baseline, so there is no verdict to report`,
    );
  }
  const integrity = checkTransformIntegrity(transform);
  if (!integrity.ok) {
    throw new Error(
      `buildVerdict(${task}): the megasaver arm applied the saver ${integrity.applied} times but produced no byte reduction (${integrity.originalBytes}→${integrity.transformedBytes} B) — nothing was measured`,
    );
  }
  return {
    task,
    pairs,
    transform: { saver: transform.saver, bytes: transform.bytes },
    costRatio: checks?.order?.combinedRatio ?? first.costRatio,
    verified: {
      integrity,
      order: checks?.order ?? null,
      baselineDriftSmoke: checks?.baselineDriftSmoke ?? null,
    },
  };
}

// Pools the per-task ratios into one headline number. A geometric mean of each
// verdict's costRatio rather than a cost-weighted sum of arm dollars: costRatio
// is already the mean of BOTH replay orders, while any single pair's dollars
// carry that pair's cache-warming asymmetry, so summing them would quietly
// reintroduce the bias that running both orders exists to remove.
// Unweighted by design — an expensive task counts the same as a cheap one — and
// fails closed to NaN rather than pooling a ratio it cannot stand behind.
export function pooledCostRatio(verdicts: readonly ReplayVerdict[]): number {
  if (verdicts.length === 0) return Number.NaN;
  let sumOfLogs = 0;
  for (const verdict of verdicts) {
    if (!(verdict.costRatio > 0) || !Number.isFinite(verdict.costRatio)) return Number.NaN;
    sumOfLogs += Math.log(verdict.costRatio);
  }
  return Math.exp(sumOfLogs / verdicts.length);
}

// Two replays of the same pair in OPPOSITE orders must agree, or the number is
// an artifact of which arm warmed the shared prefix rather than a property of
// the saver. Same question `verdictStable` asks of two repeat runs, so it reuses
// the same fail-closed comparison; only the reason for disagreeing differs.
export function orderSensitive(ratioAB: number, ratioBA: number, tolerance: number): boolean {
  return !verdictStable(ratioAB, ratioBA, tolerance);
}

// A repeat replay of the same recording must reproduce the cost ratio within
// tolerance, or the run is unstable and no verdict may be reported — same
// "never vouch for a number we can't stand behind" contract as calibrationOk.
// costRatio can legitimately be Infinity (buildVerdict's zero-cost branch), so
// equal-Infinity counts as stable and NaN/zero/negative fail closed.
export function verdictStable(ratioA: number, ratioB: number, tolerance: number): boolean {
  if (ratioA === ratioB) return true;
  if (!(ratioA > 0) || !(ratioB > 0) || !Number.isFinite(ratioA)) return false;
  const drift = Math.abs(ratioA - ratioB) / ratioA;
  return drift <= tolerance;
}
