import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";

export type ForecastPeriod = "month" | "week";

export interface SavingsForecast {
  period: ForecastPeriod;
  periodStart: string;
  periodEnd: string;
  elapsedDays: number;
  totalDays: number;
  daysLeft: number;
  savedSoFar: { bytes: number; tokens: number; dollars: number };
  dailyRate: { tokens: number; dollars: number };
  projectedEnd: { tokens: number; dollars: number };
}

const DAY_MS = 86_400_000;

function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

function periodWindow(now: number, period: ForecastPeriod): { start: number; end: number } {
  const d = new Date(now);
  if (period === "week") {
    const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    const start = startOfDay - dow * DAY_MS;
    return { start, end: start + 7 * DAY_MS };
  }
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

export function forecastSavings(
  events: readonly TokenSaverEvent[],
  opts: { now: number; period: ForecastPeriod },
): SavingsForecast {
  const { start, end } = periodWindow(opts.now, opts.period);
  let savedBytes = 0;
  for (const e of events) {
    const t = Date.parse(e.createdAt);
    if (Number.isNaN(t) || t < start || t > opts.now) continue;
    savedBytes += e.bytesSaved;
  }
  const savedTokens = tokensFromBytes(savedBytes);
  const elapsedMs = opts.now - start;
  const totalMs = end - start;
  const elapsedDays = elapsedMs / DAY_MS;
  const totalDays = totalMs / DAY_MS;
  const projectedTokens = elapsedMs <= 0 ? savedTokens : savedTokens * (totalMs / elapsedMs);
  const dailyRateTokens = elapsedMs <= 0 ? 0 : savedTokens / elapsedDays;
  return {
    period: opts.period,
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    elapsedDays,
    totalDays,
    daysLeft: Math.max(0, totalDays - elapsedDays),
    savedSoFar: { bytes: savedBytes, tokens: savedTokens, dollars: dollarsFromTokens(savedTokens) },
    dailyRate: { tokens: dailyRateTokens, dollars: dollarsFromTokens(dailyRateTokens) },
    projectedEnd: { tokens: projectedTokens, dollars: dollarsFromTokens(projectedTokens) },
  };
}

export interface BudgetGoal {
  kind: "tokens" | "dollars";
  amount: number;
}

export interface BudgetPace {
  goal: BudgetGoal;
  savedUnit: number;
  projectedUnit: number;
  pctOfGoalSoFar: number;
  pctOfGoalProjected: number;
  onTrack: boolean;
}

export function budgetPace(forecast: SavingsForecast, goal: BudgetGoal): BudgetPace {
  const savedUnit =
    goal.kind === "dollars" ? forecast.savedSoFar.dollars : forecast.savedSoFar.tokens;
  const projectedUnit =
    goal.kind === "dollars" ? forecast.projectedEnd.dollars : forecast.projectedEnd.tokens;
  const pct = (v: number) => (goal.amount <= 0 ? 0 : v / goal.amount);
  return {
    goal,
    savedUnit,
    projectedUnit,
    pctOfGoalSoFar: pct(savedUnit),
    pctOfGoalProjected: pct(projectedUnit),
    onTrack: projectedUnit >= goal.amount,
  };
}
