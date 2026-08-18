import type { OverlayTokenSaverEvent } from "./event.js";
import type { EffectiveBudget } from "./token-budget.js";

export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_VARIANCE_MULTIPLE = 3;
export const BUDGET_VARIANCE_MIN_SAMPLES = 3;

export type MeasuredBurn = {
  burnTokens: number;
  measuredEvents: number;
  unmeasuredEvents: number;
};

// Receipts only: returnedTokens is measured at the write boundary
// (packages/stats/src/event.ts); absence means UNMEASURED, never bytes/4.
export function foldMeasuredBurn(
  events: readonly OverlayTokenSaverEvent[],
): MeasuredBurn {
  let burnTokens = 0;
  let measuredEvents = 0;
  let unmeasuredEvents = 0;
  for (const event of events) {
    if (event.returnedTokens === undefined) {
      unmeasuredEvents += 1;
    } else {
      burnTokens += event.returnedTokens;
      measuredEvents += 1;
    }
  }
  return { burnTokens, measuredEvents, unmeasuredEvents };
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export type BudgetAnnouncements = {
  warn80: boolean;
  warn100: boolean;
  variance: boolean;
};

export type EvaluateBudgetInput = {
  burn: MeasuredBurn;
  limit: EffectiveBudget | null;
  historicalBurns: readonly number[];
  announced: BudgetAnnouncements;
};

export type BudgetEvaluation = {
  lines: readonly string[];
  announced: BudgetAnnouncements;
};

function scopeLabel(limit: EffectiveBudget): string {
  return limit.taskLabel === undefined
    ? limit.scope
    : `${limit.scope} '${limit.taskLabel}'`;
}

export function evaluateBudget(input: EvaluateBudgetInput): BudgetEvaluation {
  const lines: string[] = [];
  const announced = { ...input.announced };
  const { burn, limit } = input;
  const coverage = `${burn.measuredEvents}/${burn.measuredEvents + burn.unmeasuredEvents} events measured`;
  if (
    limit !== null &&
    burn.burnTokens >= limit.limitTokens &&
    !announced.warn100
  ) {
    lines.push(
      `[Mega Saver budget] EXCEEDED the ${limit.limitTokens}-token ${scopeLabel(limit)} budget: ` +
        `${burn.burnTokens} measured tokens (${coverage}). This is warn-only — nothing is blocked.`,
    );
    announced.warn100 = true;
    announced.warn80 = true;
  } else if (
    limit !== null &&
    burn.burnTokens >= limit.limitTokens * BUDGET_WARN_RATIO &&
    !announced.warn80
  ) {
    const pct = Math.floor((burn.burnTokens / limit.limitTokens) * 100);
    lines.push(
      `[Mega Saver budget] at ${pct}% (>=80%) of the ${limit.limitTokens}-token ` +
        `${scopeLabel(limit)} budget: ${burn.burnTokens} measured tokens (${coverage}).`,
    );
    announced.warn80 = true;
  }
  const median = medianOf(input.historicalBurns);
  if (
    !announced.variance &&
    median !== null &&
    median > 0 &&
    input.historicalBurns.length >= BUDGET_VARIANCE_MIN_SAMPLES &&
    burn.burnTokens >= median * BUDGET_VARIANCE_MULTIPLE
  ) {
    lines.push(
      `[Mega Saver budget] variance alarm: ${burn.burnTokens} measured tokens is >=` +
        `${BUDGET_VARIANCE_MULTIPLE}x the median ${median} of ${input.historicalBurns.length} ` +
        "prior sessions with this task label.",
    );
    announced.variance = true;
  }
  return { lines, announced };
}
