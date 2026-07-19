import type {
  ArmIntegrity,
  ArmUsage,
  DriftSmokeResult,
  OrderCheck,
  ReplayVerdict,
} from "./types.js";

export function costRatioOf(baseline: ArmUsage, megasaver: ArmUsage): number {
  return megasaver.normalizedCostUsd === 0
    ? Number.POSITIVE_INFINITY
    : baseline.normalizedCostUsd / megasaver.normalizedCostUsd;
}

// The guard that watches the arm which can actually fail. Every moving part of
// this harness lives in the megasaver arm; the baseline arm is a byte-for-byte
// replay with no transform applied. `applied > 0` only proves the hook returned
// SOMETHING — an arm that handed back the same bytes is as meaningless as an
// inert one, and its costRatio ≈ 1.00 reads as a healthy "no effect" result.
export function checkArmIntegrity(megasaver: ArmUsage): ArmIntegrity {
  const { original, transformed } = megasaver.bytes;
  return {
    applied: megasaver.saver.applied,
    originalBytes: original,
    transformedBytes: transformed,
    byteRatio: original === 0 ? Number.NaN : transformed / original,
    ok: megasaver.saver.applied > 0 && original > 0 && transformed < original,
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
// never as passed.
export function buildVerdict(
  task: string,
  baseline: ArmUsage,
  megasaver: ArmUsage,
  checks?: { order?: OrderCheck; baselineDriftSmoke?: DriftSmokeResult },
): ReplayVerdict {
  if (megasaver.saver.applied === 0) {
    throw new Error(
      `buildVerdict(${task}): the megasaver arm applied the saver 0 times (passthrough=${megasaver.saver.passthrough}, failed=${megasaver.saver.failed}) — it is identical to baseline, so there is no verdict to report`,
    );
  }
  const integrity = checkArmIntegrity(megasaver);
  if (!integrity.ok) {
    throw new Error(
      `buildVerdict(${task}): the megasaver arm applied the saver ${integrity.applied} times but produced no byte reduction (${integrity.originalBytes}→${integrity.transformedBytes} B) — nothing was measured`,
    );
  }
  return {
    task,
    baseline,
    megasaver,
    costRatio: checks?.order?.combinedRatio ?? costRatioOf(baseline, megasaver),
    verified: {
      integrity,
      order: checks?.order ?? null,
      baselineDriftSmoke: checks?.baselineDriftSmoke ?? null,
    },
  };
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
