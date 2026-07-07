import { CONTEXT_WINDOW_TOKENS, type TokenSaverEvent } from "@megasaver/stats";
import { forecastSavings } from "./forecast.js";

// The live Gumroad/site price is canonical (user decision 2026-07-07).
export const PRO_PRICE_USD_PER_MONTH = 7.99;

export interface RoiReport {
  period: "month";
  periodStart: string;
  periodEnd: string;
  daysLeft: number;
  priceUsd: number;
  savedSoFar: { bytes: number; tokens: number; dollars: number };
  projectedEnd: { tokens: number; dollars: number };
  roiSoFar: number;
  roiProjected: number;
  contextWindowsReclaimed: number;
  paidForItself: boolean;
}

export function computeRoi(
  events: readonly TokenSaverEvent[],
  opts: { now: number; priceUsd: number },
): RoiReport {
  const f = forecastSavings(events, { now: opts.now, period: "month" });
  // priceUsd<=0 → 0 mirrors budgetPace's amount<=0 rule: never NaN/Infinity.
  const ratio = (dollars: number) => (opts.priceUsd <= 0 ? 0 : dollars / opts.priceUsd);
  const roiSoFar = ratio(f.savedSoFar.dollars);
  return {
    period: "month",
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    daysLeft: f.daysLeft,
    priceUsd: opts.priceUsd,
    savedSoFar: f.savedSoFar,
    projectedEnd: f.projectedEnd,
    roiSoFar,
    roiProjected: ratio(f.projectedEnd.dollars),
    contextWindowsReclaimed: f.savedSoFar.tokens / CONTEXT_WINDOW_TOKENS,
    paidForItself: roiSoFar >= 1,
  };
}
