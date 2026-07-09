// packages/pro-analytics/test/alerts.test.ts
import { describe, expect, it } from "vitest";
import {
  ALERT_FALLBACK_MULTIPLE,
  ALERT_FIREWALL_FLOOR_EVENTS,
  ALERT_K_MAD,
  ALERT_MIN_HISTORY_DAYS,
  ALERT_RATIO_FLOOR_BYTES,
  ALERT_RATIO_MIN_DROP,
  ALERT_SOURCE_FLOOR_TOKENS,
  ALERT_TRAFFIC_FLOOR_TOKENS,
  ALERT_WINDOW_DAYS_DEFAULT,
  detectAnomalies,
} from "../src/alerts.js";
import type { FirewallEventInput } from "../src/firewall-report.js";

// tokensFromBytes is bytes/4 (see @megasaver/stats).
// NOW is mid-day so "today" (2026-07-15) is unambiguous in UTC.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const DAY = 86_400_000;

let seq = 0;
function ev(over: {
  createdAt: string;
  rawBytes: number;
  bytesSaved?: number;
  label?: string;
}) {
  const bytesSaved = over.bytesSaved ?? Math.floor(over.rawBytes / 2);
  return {
    id: `e${seq++}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: over.createdAt,
    sourceKind: "file",
    label: over.label ?? "read",
    rawBytes: over.rawBytes,
    returnedBytes: over.rawBytes - bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "",
    mode: "safe",
  } as never;
}

// One event per day for `days` days ending yesterday (2026-07-14 backwards).
function dailyHistory(days: number, rawBytes: number, label = "read") {
  const out = [];
  for (let i = 1; i <= days; i++) {
    out.push(ev({ createdAt: new Date(NOW - i * DAY).toISOString(), rawBytes, label }));
  }
  return out;
}

const fw = (daysAgo: number, count: number): FirewallEventInput => ({
  at: new Date(NOW - daysAgo * DAY).toISOString(),
  kind: "redacted",
  detector: "credit_card",
  count,
});

describe("detectAnomalies — constants (spec-locked)", () => {
  it("exports the locked values", () => {
    expect(ALERT_WINDOW_DAYS_DEFAULT).toBe(30);
    expect(ALERT_MIN_HISTORY_DAYS).toBe(7);
    expect(ALERT_K_MAD).toBe(3.5);
    expect(ALERT_FALLBACK_MULTIPLE).toBe(4);
    expect(ALERT_TRAFFIC_FLOOR_TOKENS).toBe(50_000);
    expect(ALERT_SOURCE_FLOOR_TOKENS).toBe(25_000);
    expect(ALERT_FIREWALL_FLOOR_EVENTS).toBe(5);
    expect(ALERT_RATIO_MIN_DROP).toBe(0.15);
    expect(ALERT_RATIO_FLOOR_BYTES).toBe(262_144);
  });
});

describe("detectAnomalies — traffic axis", () => {
  it("flags a spike day over a quiet baseline (MAD=0 fallback → floor)", () => {
    // 14 quiet days at 400_000 B (100k tokens); windowDays 30 pads 16 zero
    // days, so baseline median = 0, MAD = 0 → threshold max(0, floor) = 50k.
    const events = [
      ...dailyHistory(14, 400_000),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 8_000_000 }), // 2M tokens today
    ];
    const report = detectAnomalies(events, [], null, { now: NOW });
    const traffic = report.findings.find((f) => f.axis === "traffic");
    expect(traffic).toBeDefined();
    expect(traffic?.todayValue).toBe(2_000_000);
    expect(traffic?.baselineMedian).toBe(0);
    expect(report.status).toBe("alerts");
  });

  it("MAD>0 path: median+3.5·MAD threshold; above triggers, below does not", () => {
    // windowDays 14, alternating 100k/200k token days → median 150k, MAD 50k,
    // threshold 150k + 3.5·50k = 325k tokens.
    const base = [];
    for (let i = 1; i <= 14; i++) {
      base.push(
        ev({
          createdAt: new Date(NOW - i * DAY).toISOString(),
          rawBytes: i % 2 === 0 ? 400_000 : 800_000,
        }),
      );
    }
    const spike = detectAnomalies(
      [...base, ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_600_000 })], // 400k
      [],
      null,
      { now: NOW, windowDays: 14 },
    );
    expect(spike.findings.some((f) => f.axis === "traffic")).toBe(true);

    const quiet = detectAnomalies(
      [...base, ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_200_000 })], // 300k
      [],
      null,
      { now: NOW, windowDays: 14 },
    );
    expect(quiet.findings.some((f) => f.axis === "traffic")).toBe(false);
  });

  it("the absolute floor suppresses spikes on tiny traffic", () => {
    // 14 days at 1k tokens; today 10k tokens = 10× median but < 50k floor.
    const events = [
      ...dailyHistory(14, 4_000),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 40_000 }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "traffic")).toBe(false);
  });
});

describe("detectAnomalies — source axis", () => {
  it("flags only the ballooning label, keyed by label", () => {
    // "mcp:huge": 14 days at 10k tokens/day → MAD 0 → threshold max(40k, 25k) = 40k.
    // Today it does 50k tokens (> 40k, ≥ 25k floor) → finding.
    // "read" stays quiet today → no finding for it.
    const events = [
      ...dailyHistory(14, 40_000, "mcp:huge"),
      ...dailyHistory(14, 40_000, "read"),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 200_000, label: "mcp:huge" }),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 40_000, label: "read" }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    const sources = report.findings.filter((f) => f.axis === "source");
    expect(sources).toHaveLength(1);
    expect(sources[0]?.key).toBe("mcp:huge");
  });

  it("labels below the source floor today are never tested", () => {
    const events = [
      ...dailyHistory(14, 400, "tiny"),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 4_000, label: "tiny" }), // 1k tokens < 25k
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "source")).toBe(false);
  });
});

describe("detectAnomalies — ratio axis (lower tail, active-day baseline)", () => {
  it("flags a compression-effectiveness collapse", () => {
    // 14 active days ratio 0.6; today ratio 0.2 on ≥256KiB traffic.
    // median 0.6, MAD 0 → threshold 0.6 − max(0, 0.15) = 0.45; 0.2 < 0.45.
    const events = [
      ...Array.from({ length: 14 }, (_, i) =>
        ev({
          createdAt: new Date(NOW - (i + 1) * DAY).toISOString(),
          rawBytes: 1_000_000,
          bytesSaved: 600_000,
        }),
      ),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_000_000, bytesSaved: 200_000 }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    const ratio = report.findings.find((f) => f.axis === "ratio");
    expect(ratio).toBeDefined();
    expect(ratio?.todayValue).toBeCloseTo(0.2);
    expect(ratio?.baselineMedian).toBeCloseTo(0.6);
  });

  it("a mild dip above the threshold does not trigger", () => {
    const events = [
      ...Array.from({ length: 14 }, (_, i) =>
        ev({
          createdAt: new Date(NOW - (i + 1) * DAY).toISOString(),
          rawBytes: 1_000_000,
          bytesSaved: 600_000,
        }),
      ),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_000_000, bytesSaved: 500_000 }), // 0.5 > 0.45
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "ratio")).toBe(false);
  });

  it("thin traffic today suppresses the ratio verdict", () => {
    const events = [
      ...Array.from({ length: 14 }, (_, i) =>
        ev({
          createdAt: new Date(NOW - (i + 1) * DAY).toISOString(),
          rawBytes: 1_000_000,
          bytesSaved: 600_000,
        }),
      ),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 100_000, bytesSaved: 10_000 }), // < 262_144 B
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "ratio")).toBe(false);
  });

  it("zero-traffic days are excluded from the ratio baseline (windowDays 30, only 8 active days)", () => {
    // 8 active days at ratio 0.6 spread over the window — with zeros INCLUDED
    // the median would be 0 and a collapse could never fire. Active-day
    // baseline keeps median 0.6.
    const events = [
      ...Array.from({ length: 8 }, (_, i) =>
        ev({
          createdAt: new Date(NOW - (i + 2) * 3 * DAY).toISOString(), // every 3rd day
          rawBytes: 1_000_000,
          bytesSaved: 600_000,
        }),
      ),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_000_000, bytesSaved: 100_000 }), // 0.1
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 30 });
    const ratio = report.findings.find((f) => f.axis === "ratio");
    expect(ratio).toBeDefined();
    expect(ratio?.baselineMedian).toBeCloseTo(0.6);
  });

  it("fewer than 7 active baseline days → ratio in insufficientAxes", () => {
    const events = [
      ...Array.from({ length: 4 }, (_, i) =>
        ev({
          createdAt: new Date(NOW - (i + 1) * DAY).toISOString(),
          rawBytes: 1_000_000,
          bytesSaved: 600_000,
        }),
      ),
      // history spans ≥7 calendar days so the OTHER event axes stay ready:
      ev({
        createdAt: new Date(NOW - 10 * DAY).toISOString(),
        rawBytes: 1_000_000,
        bytesSaved: 600_000,
      }),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_000_000, bytesSaved: 100_000 }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 30 });
    expect(report.insufficientAxes).toContain("ratio");
    expect(report.insufficientAxes).not.toContain("traffic");
  });
});

describe("detectAnomalies — firewall axis", () => {
  it("sums count per day (not line count) and flags a surge", () => {
    // 14 days at 1 event/day → MAD 0 → threshold max(4, 5) = 5.
    // Today: one row with count 12 → 12 > 5 → finding.
    const fwEvents = [...Array.from({ length: 14 }, (_, i) => fw(i + 1, 1)), fw(0, 12)];
    const report = detectAnomalies([], fwEvents, null, { now: NOW, windowDays: 14 });
    const finding = report.findings.find((f) => f.axis === "firewall");
    expect(finding).toBeDefined();
    expect(finding?.todayValue).toBe(12);
  });

  it("a quiet firewall day does not trigger", () => {
    const fwEvents = [
      ...Array.from({ length: 14 }, (_, i) => fw(i + 1, 1)),
      fw(0, 3), // 3 < floor 5
    ];
    const report = detectAnomalies([], fwEvents, null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "firewall")).toBe(false);
  });

  it("firewall history is independent: young ledger → firewall insufficient, event axes unaffected", () => {
    const events = [
      ...dailyHistory(14, 400_000),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 400_000 }),
    ];
    const report = detectAnomalies(events, [fw(1, 2), fw(0, 2)], null, {
      now: NOW,
      windowDays: 14,
    });
    expect(report.insufficientAxes).toContain("firewall");
    expect(report.insufficientAxes).not.toContain("traffic");
    expect(report.historyDays.firewall).toBeLessThan(ALERT_MIN_HISTORY_DAYS);
    expect(report.historyDays.events).toBeGreaterThanOrEqual(ALERT_MIN_HISTORY_DAYS);
  });
});

describe("detectAnomalies — budget axis", () => {
  // Budget reuses forecastSavings+budgetPace: 14 days × 1M saved tokens over
  // 14.5 elapsed days of a 31-day month → projection = 14M × 31/14.5 ≈ 29.9M.
  const steady = [
    ...Array.from({ length: 14 }, (_, i) =>
      ev({
        createdAt: new Date(NOW - (i + 1) * DAY).toISOString(),
        rawBytes: 8_000_000,
        bytesSaved: 4_000_000, // 1M tokens/day
      }),
    ),
  ];

  it("behind the goal → finding with threshold = goal amount", () => {
    const report = detectAnomalies(
      steady,
      [],
      { period: "month", goal: { kind: "tokens", amount: 100_000_000 } },
      { now: NOW, windowDays: 14 },
    );
    const finding = report.findings.find((f) => f.axis === "budget");
    expect(finding).toBeDefined();
    expect(finding?.threshold).toBe(100_000_000);
    expect(finding?.message).toContain("behind budget");
  });

  it("on track → no budget finding; null budget → axis silently skipped", () => {
    const onTrack = detectAnomalies(
      steady,
      [],
      { period: "month", goal: { kind: "tokens", amount: 10_000_000 } },
      { now: NOW, windowDays: 14 },
    );
    expect(onTrack.findings.some((f) => f.axis === "budget")).toBe(false);

    const noBudget = detectAnomalies(steady, [], null, { now: NOW, windowDays: 14 });
    expect(noBudget.findings.some((f) => f.axis === "budget")).toBe(false);
    expect(noBudget.insufficientAxes).not.toContain("budget");
  });
});

describe("detectAnomalies — history + status + shape", () => {
  it("under 7 days of history everywhere → insufficient-history", () => {
    const events = [ev({ createdAt: new Date(NOW - 2 * DAY).toISOString(), rawBytes: 400_000 })];
    const report = detectAnomalies(events, [], null, { now: NOW });
    expect(report.status).toBe("insufficient-history");
    expect(report.findings).toHaveLength(0);
    expect(report.insufficientAxes).toEqual(
      expect.arrayContaining(["traffic", "source", "ratio", "firewall"]),
    );
  });

  it("empty everything → insufficient-history with zero historyDays, never NaN", () => {
    const report = detectAnomalies([], [], null, { now: NOW });
    expect(report.status).toBe("insufficient-history");
    expect(report.historyDays).toEqual({ events: 0, firewall: 0 });
    for (const f of report.findings) {
      expect(Number.isFinite(f.todayValue)).toBe(true);
    }
  });

  it("today never contributes to its own baseline", () => {
    // Only today has traffic (plus one 8-day-old event to unlock history):
    // a huge today over a zero baseline must still trigger via the floor
    // fallback, proving today is not averaged into the baseline.
    const events = [
      ev({ createdAt: new Date(NOW - 8 * DAY).toISOString(), rawBytes: 4_000 }),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 8_000_000 }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW });
    const traffic = report.findings.find((f) => f.axis === "traffic");
    expect(traffic).toBeDefined();
    expect(traffic?.baselineMedian).toBe(0);
  });

  it("windowDays defaults to 30, report echoes it, advice is per-axis unique", () => {
    const events = [
      ...dailyHistory(14, 400_000),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 8_000_000 }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW });
    expect(report.windowDays).toBe(ALERT_WINDOW_DAYS_DEFAULT);
    expect(report.today).toBe("2026-07-15");
    expect(report.advice.length).toBe(new Set(report.findings.map((f) => f.axis)).size);
  });

  it("is deterministic: same inputs → deep-equal reports", () => {
    const events = [
      ...dailyHistory(14, 400_000),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 8_000_000 }),
    ];
    const a = detectAnomalies(events, [fw(1, 1)], null, { now: NOW });
    const b = detectAnomalies(events, [fw(1, 1)], null, { now: NOW });
    expect(a).toEqual(b);
  });

  it("unparseable createdAt and future events are skipped", () => {
    // The future event is later TODAY (NOW + 1h, same UTC day): if the
    // `t > now` guard were dropped it would inflate today's traffic to ~250M
    // tokens and fire — this pins the guard, not just the day bucketing.
    const events = [
      ...dailyHistory(14, 400_000),
      ev({ createdAt: "not-a-date", rawBytes: 999_999_999 }),
      ev({ createdAt: new Date(NOW + 3_600_000).toISOString(), rawBytes: 999_999_999 }),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 400_000 }),
    ];
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "traffic")).toBe(false);
  });
});

// The absolute floors and the strict `>` boundary are the anti-noise guards.
// Every axis test above uses a FLAT (MAD=0) baseline, where upperStats' own
// `max(4×median, floor)` fallback already forces threshold ≥ floor — so the
// `&& today >= floor` conjunct and the strict `>` are never the deciding
// factor. These cases put the decision squarely on those guards (MAD>0 with
// threshold < floor), so removing the conjunct or flipping `>`→`>=` flips the
// verdict and fails a test.
describe("detectAnomalies — floor + boundary guards (mutation coverage)", () => {
  it("traffic: today clears the MAD threshold but is below the token floor → no finding", () => {
    // Alternating 5k/8k token days → median 6500, MAD 1500, threshold ~11750.
    // Today 20k tokens > 11750 but < 50k floor → suppressed by the floor conjunct.
    const events = [];
    for (let i = 1; i <= 14; i++) {
      events.push(
        ev({
          createdAt: new Date(NOW - i * DAY).toISOString(),
          rawBytes: i % 2 === 0 ? 20_000 : 32_000,
        }),
      );
    }
    events.push(ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 80_000 })); // 20k tokens
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "traffic")).toBe(false);
  });

  it("firewall: today clears the MAD threshold but is below the event floor → no finding", () => {
    // Counts alternating 1/2 → median 1.5, MAD 0.5, threshold 3.25.
    // Today 4 > 3.25 but < 5-event floor → suppressed by the floor conjunct.
    const fwEvents: FirewallEventInput[] = [];
    for (let i = 1; i <= 14; i++) fwEvents.push(fw(i, i % 2 === 0 ? 1 : 2));
    fwEvents.push(fw(0, 4));
    const report = detectAnomalies([], fwEvents, null, { now: NOW, windowDays: 14 });
    expect(report.findings.some((f) => f.axis === "firewall")).toBe(false);
  });

  it("today exactly at the threshold does not fire (strict >, not >=)", () => {
    // All-zero baseline (one tiny 8-day-old event unlocks history) → threshold
    // = floor = 50k. Today exactly 50k tokens: 50000 > 50000 is false.
    const events = [
      ev({ createdAt: new Date(NOW - 8 * DAY).toISOString(), rawBytes: 4_000 }),
      ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 200_000 }), // exactly 50k tokens
    ];
    const report = detectAnomalies(events, [], null, { now: NOW });
    expect(report.findings.some((f) => f.axis === "traffic")).toBe(false);
  });

  it("today is excluded from its own baseline even when inclusion would flip the verdict", () => {
    // Alternating 100k/300k token baseline → median 200k, MAD 100k, threshold 550k.
    // Today 600k fires. If today LEAKED into the baseline, median→300k and
    // threshold→1M, suppressing the spike — so this pins the exclusion for real,
    // not incidentally over a zero-dominated baseline.
    const events = [];
    for (let i = 1; i <= 14; i++) {
      events.push(
        ev({
          createdAt: new Date(NOW - i * DAY).toISOString(),
          rawBytes: i % 2 === 0 ? 400_000 : 1_200_000,
        }),
      );
    }
    events.push(ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 2_400_000 })); // 600k tokens
    const report = detectAnomalies(events, [], null, { now: NOW, windowDays: 14 });
    const traffic = report.findings.find((f) => f.axis === "traffic");
    expect(traffic).toBeDefined();
    expect(traffic?.baselineMedian).toBe(200_000);
  });
});
