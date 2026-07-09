// packages/pro-analytics/src/alerts.ts
// Pure anomaly detector over the savings + firewall streams (1.13 spec §1).
// Deterministic robust statistics — median + MAD over trailing UTC-day
// baselines that never include today. No I/O, no LLM.
import { type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";
import type { FirewallEventInput } from "./firewall-report.js";
import { type BudgetGoal, type ForecastPeriod, budgetPace, forecastSavings } from "./forecast.js";

export type AlertAxis = "traffic" | "source" | "ratio" | "firewall" | "budget";

export interface AnomalyFinding {
  axis: AlertAxis;
  key: string | null;
  todayValue: number;
  baselineMedian: number;
  threshold: number;
  message: string;
}

export interface AlertsReport {
  windowDays: number;
  today: string;
  historyDays: { events: number; firewall: number };
  status: "ok" | "alerts" | "insufficient-history";
  findings: AnomalyFinding[];
  insufficientAxes: AlertAxis[];
  advice: string[];
}

export interface StoredBudgetInput {
  period: ForecastPeriod;
  goal: BudgetGoal;
}

export const ALERT_WINDOW_DAYS_DEFAULT = 30;
export const ALERT_MIN_HISTORY_DAYS = 7;
export const ALERT_K_MAD = 3.5;
export const ALERT_FALLBACK_MULTIPLE = 4;
export const ALERT_TRAFFIC_FLOOR_TOKENS = 50_000;
export const ALERT_SOURCE_FLOOR_TOKENS = 25_000;
export const ALERT_FIREWALL_FLOOR_EVENTS = 5;
export const ALERT_RATIO_MIN_DROP = 0.15;
export const ALERT_RATIO_FLOOR_BYTES = 262_144;

export const ALERT_ADVICE = {
  traffic: "context traffic spiked — run `mega savings insights` to see which source ballooned",
  source: "a single source spiked — run `mega teardown` for a share-safe exposé of the culprit",
  ratio: "compression effectiveness dropped — run `mega savings fix` for one-line remediations",
  firewall: "redaction volume spiked — run `mega firewall` and review what leaked into tool output",
  budget:
    "projected savings are behind your budget — run `mega savings forecast` for the pace detail",
} as const;

const DAY_MS = 86_400_000;

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

// median + K·MAD upper threshold. MAD is 0 on flat baselines (including the
// all-zero padding of a young history), where a spread-based threshold would
// collapse to the median — fall back to a multiple-of-median with a per-axis
// absolute floor instead.
function upperStats(
  baseline: readonly number[],
  floor: number,
): { median: number; threshold: number } {
  const med = medianOf(baseline);
  const mad = medianOf(baseline.map((v) => Math.abs(v - med)));
  const threshold =
    mad > 0 ? med + ALERT_K_MAD * mad : Math.max(ALERT_FALLBACK_MULTIPLE * med, floor);
  return { median: med, threshold };
}

// Trailing `windowDays` calendar days ending YESTERDAY; missing days are 0.
function baselineSeries(
  byDay: ReadonlyMap<string, number>,
  todayStart: number,
  windowDays: number,
): number[] {
  const series: number[] = [];
  for (let i = windowDays; i >= 1; i--) {
    series.push(byDay.get(dayKey(todayStart - i * DAY_MS)) ?? 0);
  }
  return series;
}

function addTo(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function historyDaysOf(firstDayStart: number, todayStart: number, windowDays: number): number {
  if (!Number.isFinite(firstDayStart)) return 0;
  return Math.min(windowDays, Math.max(0, Math.round((todayStart - firstDayStart) / DAY_MS)));
}

export function detectAnomalies(
  events: readonly TokenSaverEvent[],
  firewallEvents: readonly FirewallEventInput[],
  budget: StoredBudgetInput | null,
  opts: { now: number; windowDays?: number },
): AlertsReport {
  const windowDays = opts.windowDays ?? ALERT_WINDOW_DAYS_DEFAULT;
  const todayStart = utcDayStart(opts.now);
  const today = dayKey(opts.now);
  const findings: AnomalyFinding[] = [];
  const insufficientAxes: AlertAxis[] = [];

  // Savings stream, aggregated by UTC day. Unparseable timestamps and
  // beyond-now events are excluded (the forecastSavings rule).
  const rawByDay = new Map<string, number>();
  const savedByDay = new Map<string, number>();
  const rawByLabelDay = new Map<string, Map<string, number>>();
  let firstEventDay = Number.POSITIVE_INFINITY;
  for (const e of events) {
    const t = Date.parse(e.createdAt);
    if (Number.isNaN(t) || t > opts.now) continue;
    const day = dayKey(t);
    addTo(rawByDay, day, e.rawBytes);
    addTo(savedByDay, day, e.bytesSaved);
    let labelMap = rawByLabelDay.get(e.label);
    if (labelMap === undefined) {
      labelMap = new Map();
      rawByLabelDay.set(e.label, labelMap);
    }
    addTo(labelMap, day, e.rawBytes);
    firstEventDay = Math.min(firstEventDay, utcDayStart(t));
  }
  const eventsHistoryDays = historyDaysOf(firstEventDay, todayStart, windowDays);
  const eventsReady = eventsHistoryDays >= ALERT_MIN_HISTORY_DAYS;

  // Firewall stream: Σcount per day. Counts only — the F-FW-1 value-free
  // invariant holds; no matched value ever reaches this function.
  const fwByDay = new Map<string, number>();
  let firstFwDay = Number.POSITIVE_INFINITY;
  for (const e of firewallEvents) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t > opts.now) continue;
    addTo(fwByDay, dayKey(t), e.count);
    firstFwDay = Math.min(firstFwDay, utcDayStart(t));
  }
  const firewallHistoryDays = historyDaysOf(firstFwDay, todayStart, windowDays);
  const firewallReady = firewallHistoryDays >= ALERT_MIN_HISTORY_DAYS;

  // -- traffic
  if (eventsReady) {
    const tokensByDay = new Map<string, number>();
    for (const [day, bytes] of rawByDay) tokensByDay.set(day, tokensFromBytes(bytes));
    const stats = upperStats(
      baselineSeries(tokensByDay, todayStart, windowDays),
      ALERT_TRAFFIC_FLOOR_TOKENS,
    );
    const todayTokens = tokensByDay.get(today) ?? 0;
    if (todayTokens > stats.threshold && todayTokens >= ALERT_TRAFFIC_FLOOR_TOKENS) {
      findings.push({
        axis: "traffic",
        key: null,
        todayValue: todayTokens,
        baselineMedian: stats.median,
        threshold: stats.threshold,
        message: `context traffic today ~${Math.round(todayTokens)} tokens vs baseline median ~${Math.round(stats.median)} (threshold ~${Math.round(stats.threshold)})`,
      });
    }
  } else {
    insufficientAxes.push("traffic");
  }

  // -- source (per label; alpha order for determinism)
  if (eventsReady) {
    for (const label of [...rawByLabelDay.keys()].sort()) {
      const labelDays = rawByLabelDay.get(label) as Map<string, number>;
      const todayTokens = tokensFromBytes(labelDays.get(today) ?? 0);
      if (todayTokens < ALERT_SOURCE_FLOOR_TOKENS) continue;
      const tokensByDay = new Map<string, number>();
      for (const [day, bytes] of labelDays) tokensByDay.set(day, tokensFromBytes(bytes));
      const stats = upperStats(
        baselineSeries(tokensByDay, todayStart, windowDays),
        ALERT_SOURCE_FLOOR_TOKENS,
      );
      if (todayTokens > stats.threshold) {
        findings.push({
          axis: "source",
          key: label,
          todayValue: todayTokens,
          baselineMedian: stats.median,
          threshold: stats.threshold,
          message: `${label}: today ~${Math.round(todayTokens)} tokens vs its median ~${Math.round(stats.median)} (threshold ~${Math.round(stats.threshold)})`,
        });
      }
    }
  } else {
    insufficientAxes.push("source");
  }

  // -- ratio (lower tail; ACTIVE baseline days only — zeros would drag the
  //    median down and blind the collapse detector)
  const activeRatios: number[] = [];
  for (let i = windowDays; i >= 1; i--) {
    const day = dayKey(todayStart - i * DAY_MS);
    const raw = rawByDay.get(day) ?? 0;
    if (raw <= 0) continue;
    activeRatios.push((savedByDay.get(day) ?? 0) / raw);
  }
  if (eventsReady && activeRatios.length >= ALERT_MIN_HISTORY_DAYS) {
    const med = medianOf(activeRatios);
    const mad = medianOf(activeRatios.map((v) => Math.abs(v - med)));
    const threshold = med - Math.max(ALERT_K_MAD * mad, ALERT_RATIO_MIN_DROP);
    const todayRaw = rawByDay.get(today) ?? 0;
    const todayRatio = todayRaw > 0 ? (savedByDay.get(today) ?? 0) / todayRaw : 0;
    if (todayRaw >= ALERT_RATIO_FLOOR_BYTES && todayRatio < threshold) {
      findings.push({
        axis: "ratio",
        key: null,
        todayValue: todayRatio,
        baselineMedian: med,
        threshold,
        message: `saving ratio today ${(todayRatio * 100).toFixed(0)}% vs median ${(med * 100).toFixed(0)}% (threshold ${(threshold * 100).toFixed(0)}%)`,
      });
    }
  } else {
    insufficientAxes.push("ratio");
  }

  // -- firewall
  if (firewallReady) {
    const stats = upperStats(
      baselineSeries(fwByDay, todayStart, windowDays),
      ALERT_FIREWALL_FLOOR_EVENTS,
    );
    const todayCount = fwByDay.get(today) ?? 0;
    if (todayCount > stats.threshold && todayCount >= ALERT_FIREWALL_FLOOR_EVENTS) {
      findings.push({
        axis: "firewall",
        key: null,
        todayValue: todayCount,
        baselineMedian: stats.median,
        threshold: stats.threshold,
        message: `${todayCount} firewall events today vs baseline median ${stats.median} (threshold ${Math.ceil(stats.threshold)})`,
      });
    }
  } else {
    insufficientAxes.push("firewall");
  }

  // -- budget (config-driven: absent budget is a skip, not insufficiency)
  if (budget !== null) {
    const pace = budgetPace(
      forecastSavings(events, { now: opts.now, period: budget.period }),
      budget.goal,
    );
    if (!pace.onTrack) {
      const fmt = (v: number) =>
        budget.goal.kind === "dollars" ? `$${v.toFixed(2)}` : `${Math.round(v)} tokens`;
      findings.push({
        axis: "budget",
        key: null,
        todayValue: pace.projectedUnit,
        baselineMedian: 0,
        threshold: budget.goal.amount,
        message: `behind budget: projected ${fmt(pace.projectedUnit)} of ${fmt(budget.goal.amount)} (${Math.round(pace.pctOfGoalProjected * 100)}%)`,
      });
    }
  }

  const status: AlertsReport["status"] =
    findings.length > 0 ? "alerts" : insufficientAxes.length === 4 ? "insufficient-history" : "ok";

  const seen = new Set<AlertAxis>();
  const advice: string[] = [];
  for (const f of findings) {
    if (seen.has(f.axis)) continue;
    seen.add(f.axis);
    advice.push(ALERT_ADVICE[f.axis]);
  }

  return {
    windowDays,
    today,
    historyDays: { events: eventsHistoryDays, firewall: firewallHistoryDays },
    status,
    findings,
    insufficientAxes,
    advice,
  };
}
