import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";

export type BucketGranularity = "day" | "week";

export interface HistoryPoint {
  bucket: string;
  tokensSaved: number;
  dollarsSaved: number;
  events: number;
}

export interface ProjectRow {
  project: string;
  tokensSaved: number;
  dollarsSaved: number;
  events: number;
}

// One price model shared with the free savings headline
// (savingsHeadlineFromTokens): saved tokens were never sent, so they carry no
// cache discount — a flat per-MTok input rate.
function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

function utcDayBucket(createdAt: string): string {
  return createdAt.slice(0, 10);
}

// ISO-8601 week key `YYYY-Www`. The ISO week-year can differ from the calendar
// year at boundaries (e.g. 2021-01-01 is 2020-W53), so both the year and week
// are derived from the Thursday of the event's week.
function isoWeekBucket(createdAt: string): string {
  const d = new Date(createdAt);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

type Accumulator = { bytesSaved: number; events: number };

function accumulate(
  events: readonly TokenSaverEvent[],
  keyOf: (e: TokenSaverEvent) => string,
): Map<string, Accumulator> {
  const byKey = new Map<string, Accumulator>();
  for (const e of events) {
    const key = keyOf(e);
    const acc = byKey.get(key) ?? { bytesSaved: 0, events: 0 };
    acc.bytesSaved += e.bytesSaved;
    acc.events += 1;
    byKey.set(key, acc);
  }
  return byKey;
}

export function computeSavingsHistory(
  events: readonly TokenSaverEvent[],
  opts: { bucket: BucketGranularity },
): HistoryPoint[] {
  const keyOf = opts.bucket === "day" ? utcDayBucket : isoWeekBucket;
  const byKey = accumulate(events, (e) => keyOf(e.createdAt));
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, acc]) => {
      const tokensSaved = tokensFromBytes(acc.bytesSaved);
      return {
        bucket,
        tokensSaved,
        dollarsSaved: dollarsFromTokens(tokensSaved),
        events: acc.events,
      };
    });
}

export function computeSavingsByProject(
  eventsByProject: Record<string, readonly TokenSaverEvent[]>,
): ProjectRow[] {
  return Object.entries(eventsByProject)
    .map(([project, events]) => {
      const bytesSaved = events.reduce((sum, e) => sum + e.bytesSaved, 0);
      const tokensSaved = tokensFromBytes(bytesSaved);
      return {
        project,
        tokensSaved,
        dollarsSaved: dollarsFromTokens(tokensSaved),
        events: events.length,
      };
    })
    .sort((a, b) => b.tokensSaved - a.tokensSaved || (a.project < b.project ? -1 : 1));
}
