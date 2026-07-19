import type { ArmUsage, ReplayVerdict } from "./types.js";

export function buildVerdict(task: string, baseline: ArmUsage, megasaver: ArmUsage): ReplayVerdict {
  return {
    task,
    baseline,
    megasaver,
    costRatio:
      megasaver.normalizedCostUsd === 0
        ? Number.POSITIVE_INFINITY
        : baseline.normalizedCostUsd / megasaver.normalizedCostUsd,
  };
}

// The harness must never report a green gate it cannot vouch for. If the
// replayed baseline drifts from the real end-to-end baseline beyond tolerance,
// the recording or the cache model has gone stale and the verdict is void —
// a silently-drifting measurement tool is worse than no tool.
export function calibrationOk(input: {
  replayedBaselineUsd: number;
  realBaselineUsd: number;
  tolerance: number;
}): boolean {
  if (!(input.realBaselineUsd > 0)) return false;
  const drift = Math.abs(input.replayedBaselineUsd - input.realBaselineUsd) / input.realBaselineUsd;
  return drift <= input.tolerance;
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
