import { GENERATION_CAP_TOKENS } from "./transform.js";
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

// The saver's decision is per tool call and its compression floors are per tool,
// so outputs below those floors legitimately pass through and a passthrough-heavy
// run is normal — a high floor here would refuse honest measurements. This bound
// exists only to catch the measured escape where 1 tool call of 100 was rewritten
// (fraction 0.01) and the resulting costRatio 1.000081 printed as a real "no
// effect" finding.
export const MIN_APPLIED_FRACTION = 0.1;

// The ceiling. A transform that moved less than 2% of the tool_result bytes moved
// less than this harness can resolve at all — it exists for a ≤5% COST effect and
// tool_result bytes are only a fraction of the prompt — so there is nothing to
// measure and no verdict to report. Catches the near-inert escape measured at
// byteRatio 0.999942, which the old `transformed < original` test passed.
export const MAX_BYTE_RATIO = 0.98;

// The floor, which the ceiling-only check had none of: an empty-string saver
// measured byteRatio 0 — the strongest possible pass — and was certified at
// costRatio 3.6883x. The real saver appends a recovery footer and a chunk summary
// to every output it compresses, so a whole conversation has no path to a 20x
// reduction. Below this, the arm measured the ABSENCE of content, not compression
// — the exact failure class this harness must catch.
export const MIN_BYTE_RATIO = 0.05;

// The guard that watches the only part of this harness that can fail: the
// transform. It runs once for the whole gate, so this single check covers every
// pair — no arm run can quietly measure a different one. Two-sided on both axes,
// and fails closed: NaN comparisons are false, so a degenerate transform never
// reads as healthy.
export function checkTransformIntegrity(transform: TransformSummary): ArmIntegrity {
  const { original, transformed } = transform.bytes;
  const { applied, passthrough } = transform.saver;
  const consulted = applied + passthrough;
  const appliedFraction = consulted === 0 ? Number.NaN : applied / consulted;
  const byteRatio = original === 0 ? Number.NaN : transformed / original;
  return {
    applied,
    appliedFraction,
    originalBytes: original,
    transformedBytes: transformed,
    byteRatio,
    ok:
      applied > 0 &&
      original > 0 &&
      appliedFraction >= MIN_APPLIED_FRACTION &&
      byteRatio <= MAX_BYTE_RATIO &&
      byteRatio >= MIN_BYTE_RATIO,
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

// COMPUTED from the pairs, never accepted from a caller. Handed an OrderCheck as
// data, `buildVerdict` had no way to tell whether it described the pairs beside
// it: pairs with ratios 1.05 and 1.06 plus OrderCheck{combinedRatio: 9} yielded a
// verdict reporting 9, no refusal. Deriving it here removes the convention rather
// than documenting it — the caller supplies a tolerance, so there is no number to
// mismatch.
function deriveOrderCheck(
  task: string,
  pairs: readonly PairResult[],
  tolerance: number,
): OrderCheck {
  const baselineFirst = pairs.find((p) => p.order === "baseline-first");
  const megasaverFirst = pairs.find((p) => p.order === "megasaver-first");
  if (pairs.length !== 2 || baselineFirst === undefined || megasaverFirst === undefined) {
    throw new Error(
      `buildVerdict(${task}): an order check combines exactly one baseline-first and one megasaver-first pair, but the pairs given were [${pairs.map((p) => p.order).join(", ")}]`,
    );
  }
  const a = baselineFirst.costRatio;
  const b = megasaverFirst.costRatio;
  if (orderSensitive(a, b, tolerance)) {
    throw new Error(
      `buildVerdict(${task}): the run is order-sensitive — baseline-first gave ${a} and megasaver-first gave ${b} (tolerance ${tolerance}). The gap is prompt-cache warming, not saver behaviour, so there is no verdict to report`,
    );
  }
  return {
    ratioBaselineFirst: a,
    ratioMegasaverFirst: b,
    spread: a === b ? 0 : Math.abs(a - b) / a,
    tolerance,
    combinedRatio: (a + b) / 2,
  };
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
  checks?: { orderTolerance?: number; baselineDriftSmoke?: DriftSmokeResult },
): ReplayVerdict {
  const first = pairs[0];
  if (first === undefined) {
    throw new Error(`buildVerdict(${task}): no pair was replayed, so there is no ratio to report`);
  }
  const order =
    checks?.orderTolerance === undefined
      ? null
      : deriveOrderCheck(task, pairs, checks.orderTolerance);
  // A multi-pair run's number is the order check's combination of them. Without
  // that check there is no defensible way to collapse several pairs into one
  // ratio, and quoting any single pair's would be reporting a number the shown
  // arms do not account for.
  if (order === null && pairs.length > 1) {
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
      `buildVerdict(${task}): the transform measured nothing — the saver was applied to ${integrity.applied} of ${transform.saver.applied + transform.saver.passthrough} tool calls (fraction ${integrity.appliedFraction}, floor ${MIN_APPLIED_FRACTION}) and moved ${integrity.originalBytes}→${integrity.transformedBytes} B (byteRatio ${integrity.byteRatio}, required band ${MIN_BYTE_RATIO}–${MAX_BYTE_RATIO}). Above the ceiling the transform is inert; below the floor it destroyed content rather than compressing it.`,
    );
  }
  return {
    task,
    pairs,
    transform: { saver: transform.saver, bytes: transform.bytes },
    costRatio: order?.combinedRatio ?? first.costRatio,
    generationCapTokens: GENERATION_CAP_TOKENS,
    verified: {
      integrity,
      order,
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
