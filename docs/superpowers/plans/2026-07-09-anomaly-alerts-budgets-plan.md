# Anomaly Alerts + Persistent Budgets (1.13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega alerts` (deterministic median+MAD spike detection over the savings + firewall streams, plus budget pace), `mega savings budget set|show|clear` (persistent `stats/budget.json`), and forecast auto-load of the stored budget — all Pro-gated on the existing `"savings-analytics"` key.

**Architecture:** Pure detector in `@megasaver/pro-analytics` (no I/O; composes the existing `forecastSavings`/`budgetPace` and the structural `FirewallEventInput`); versioned budget store in `@megasaver/stats` re-exported through `@megasaver/core` (the §3c allow-list — apps/cli never imports stats directly); CLI commands mirror the cache/firewall gate pattern exactly (checkEntitlement FIRST, upsell exit 0, lazy `import("@megasaver/pro-analytics")` after the gate).

**Tech Stack:** TypeScript strict ESM (NodeNext), Zod, Vitest, Citty, Biome.

**Spec:** `docs/superpowers/specs/2026-07-09-anomaly-alerts-budgets-design.md` (approved; risk MEDIUM; reviewers code-reviewer + critic).

**Worktree:** execute in a fresh worktree `feat/cli-anomaly-alerts` off `main` (superpowers:using-git-worktrees). Run `pnpm install --frozen-lockfile` there first, and `pnpm build` once before CLI-suite tasks (the CLI imports dist of core/context-gate/pro-analytics).

**Key facts an implementer must know:**
- `tokensFromBytes(bytes) = Math.ceil(bytes / 4)` (from `@megasaver/stats`,
  `honest-metrics.ts:96-98`). Every fixture below uses multiples of 4 so the
  division is exact.
- `TokenSaverEvent` is `.strict()`: `{ id, sessionId, projectId, createdAt, sourceKind, label, rawBytes, returnedBytes, bytesSaved, savingRatio, chunkSetId?, summary, mode }`. Tests build it with the `as never` fixture cast (see `packages/pro-analytics/test/forecast.test.ts:5-20`).
- `FirewallEventInput` (structural, `packages/pro-analytics/src/firewall-report.ts:5-14`): `{ at, kind, detector, count, sourcePath?: string | undefined }`.
- `atomicWriteFile(filePath, content)` from `packages/stats/src/atomic-write.ts` — temp+fsync+rename, symlink-parent guard, throws `StatsError("write_failed")`.
- The CLI entitlement-gate idiom is copied verbatim from `apps/cli/src/commands/firewall.ts:44-53`.
- `exactOptionalPropertyTypes` is ON: spread-conditional optional fields (`...(x === undefined ? {} : { x })`), never assign `undefined` directly.

---

### Task 1: Budget store — `@megasaver/stats` + core re-export

**Files:**
- Create: `packages/stats/src/budget.ts`
- Create: `packages/stats/test/budget.test.ts`
- Modify: `packages/stats/src/index.ts` (append export block)
- Modify: `packages/core/src/context-gate.ts` (append a stats re-export block after line 86)

- [ ] **Step 1: Write the failing test**

```ts
// packages/stats/test/budget.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StoredBudget,
  budgetPath,
  budgetStatus,
  clearBudget,
  readBudget,
  storedBudgetSchema,
  writeBudget,
} from "../src/budget.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-budget-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BUDGET: StoredBudget = { version: 1, period: "month", kind: "dollars", amount: 20 };

describe("budget store — roundtrip", () => {
  it("writeBudget then readBudget returns the same budget", () => {
    writeBudget(root, BUDGET);
    expect(readBudget(root)).toEqual(BUDGET);
    expect(budgetStatus(root)).toBe("ok");
  });

  it("budgetPath is <root>/stats/budget.json and the write creates the dir", () => {
    expect(budgetPath(root)).toBe(join(root, "stats", "budget.json"));
    writeBudget(root, BUDGET);
    expect(JSON.parse(readFileSync(budgetPath(root), "utf8"))).toEqual(BUDGET);
  });

  it("a tokens/week budget roundtrips too", () => {
    const b: StoredBudget = { version: 1, period: "week", kind: "tokens", amount: 5_000_000 };
    writeBudget(root, b);
    expect(readBudget(root)).toEqual(b);
  });
});

describe("budget store — absent vs corrupt", () => {
  it("absent file → readBudget null, status absent", () => {
    expect(readBudget(root)).toBeNull();
    expect(budgetStatus(root)).toBe("absent");
  });

  it("corrupt JSON → readBudget null, status corrupt", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    writeFileSync(budgetPath(root), "{not json");
    expect(readBudget(root)).toBeNull();
    expect(budgetStatus(root)).toBe("corrupt");
  });

  it("schema-invalid shapes → null/corrupt (wrong version, negative amount, extra key)", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    for (const bad of [
      { version: 2, period: "month", kind: "dollars", amount: 20 },
      { version: 1, period: "month", kind: "dollars", amount: -5 },
      { version: 1, period: "month", kind: "dollars", amount: 20, extra: true },
      { version: 1, period: "day", kind: "dollars", amount: 20 },
    ]) {
      writeFileSync(budgetPath(root), JSON.stringify(bad));
      expect(readBudget(root)).toBeNull();
      expect(budgetStatus(root)).toBe("corrupt");
    }
  });
});

describe("budget store — clear", () => {
  it("clearBudget removes the file and is idempotent", () => {
    writeBudget(root, BUDGET);
    clearBudget(root);
    expect(budgetStatus(root)).toBe("absent");
    expect(() => clearBudget(root)).not.toThrow(); // second clear: no file, still fine
  });
});

describe("budget schema", () => {
  it("accepts exactly the v1 shape", () => {
    expect(storedBudgetSchema.safeParse(BUDGET).success).toBe(true);
    expect(storedBudgetSchema.safeParse({ ...BUDGET, amount: 0 }).success).toBe(false);
    expect(
      storedBudgetSchema.safeParse({ ...BUDGET, amount: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });
});

describe("budget store — write hardening (surface checks; atomicity itself is", () => {
  // covered by packages/stats/test/atomic-write.test.ts for the shared helper)
  it("overwriting a corrupt file repairs it", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    writeFileSync(budgetPath(root), "{broken");
    expect(budgetStatus(root)).toBe("corrupt");
    writeBudget(root, BUDGET);
    expect(budgetStatus(root)).toBe("ok");
    expect(readBudget(root)).toEqual(BUDGET);
  });

  it.skipIf(process.platform === "win32")(
    "refuses to write through a symlinked stats dir (StatsError write_failed)",
    () => {
      const target = mkdtempSync(join(tmpdir(), "megasaver-budget-target-"));
      try {
        symlinkSync(target, join(root, "stats"));
        expect(() => writeBudget(root, BUDGET)).toThrow();
        expect(readBudget(root)).toBeNull();
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    },
  );
});
```

(add `symlinkSync` to the `node:fs` import line of the test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/stats && npx vitest run test/budget.test.ts`
Expected: FAIL — `Cannot find module '../src/budget.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/stats/src/budget.ts
// Persistent savings budget (1.13): one store-wide config file at
// stats/budget.json. Corrupt is distinguished from absent (the license.json
// precedent) so the CLI can report honestly instead of silently ignoring a
// broken file the user thinks is active.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";

export const storedBudgetSchema = z
  .object({
    version: z.literal(1),
    period: z.enum(["month", "week"]),
    kind: z.enum(["tokens", "dollars"]),
    amount: z.number().finite().positive(),
  })
  .strict();

export type StoredBudget = z.infer<typeof storedBudgetSchema>;

export function budgetPath(root: string): string {
  return join(root, "stats", "budget.json");
}

export function readBudget(root: string): StoredBudget | null {
  let raw: string;
  try {
    raw = readFileSync(budgetPath(root), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedBudgetSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function budgetStatus(root: string): "absent" | "ok" | "corrupt" {
  if (!existsSync(budgetPath(root))) return "absent";
  return readBudget(root) === null ? "corrupt" : "ok";
}

export function writeBudget(root: string, budget: StoredBudget): void {
  atomicWriteFile(budgetPath(root), `${JSON.stringify(budget)}\n`);
}

export function clearBudget(root: string): void {
  rmSync(budgetPath(root), { force: true });
}
```

Append to `packages/stats/src/index.ts` (end of file):

```ts
export {
  budgetPath,
  budgetStatus,
  clearBudget,
  readBudget,
  storedBudgetSchema,
  type StoredBudget,
  writeBudget,
} from "./budget.js";
```

Append to `packages/core/src/context-gate.ts` immediately after the third
`from "@megasaver/stats"` block (after line 86):

```ts
// 1.13 persistent budget: the CLI reads/writes stats/budget.json through core
// (same §3c allow-list rule as readEvents above).
export {
  budgetPath,
  budgetStatus,
  clearBudget,
  readBudget,
  storedBudgetSchema,
  type StoredBudget,
  writeBudget,
} from "@megasaver/stats";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/stats && npx vitest run`
Expected: PASS (budget.test.ts green, no regressions in the stats suite)

Run: `pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/core build`
Expected: builds green (core re-export resolves)

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/budget.ts packages/stats/test/budget.test.ts packages/stats/src/index.ts packages/core/src/context-gate.ts
git commit -m "feat(stats): persistent savings budget store (stats/budget.json)"
```

---

### Task 2: Anomaly detector — `@megasaver/pro-analytics`

**Files:**
- Create: `packages/pro-analytics/src/alerts.ts`
- Create: `packages/pro-analytics/test/alerts.test.ts`
- Modify: `packages/pro-analytics/src/index.ts` (add export block BEFORE the trailing `INPUT_PRICE_PER_MTOK_USD` re-export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/pro-analytics/test/alerts.test.ts
import { describe, expect, it } from "vitest";
import type { FirewallEventInput } from "../src/firewall-report.js";
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
    out.push(
      ev({ createdAt: new Date(NOW - i * DAY).toISOString(), rawBytes, label }),
    );
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
      [], null, { now: NOW, windowDays: 14 },
    );
    expect(spike.findings.some((f) => f.axis === "traffic")).toBe(true);

    const quiet = detectAnomalies(
      [...base, ev({ createdAt: new Date(NOW).toISOString(), rawBytes: 1_200_000 })], // 300k
      [], null, { now: NOW, windowDays: 14 },
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
      ev({ createdAt: new Date(NOW - 10 * DAY).toISOString(), rawBytes: 1_000_000, bytesSaved: 600_000 }),
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
    const fwEvents = [
      ...Array.from({ length: 14 }, (_, i) => fw(i + 1, 1)),
      fw(0, 12),
    ];
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
    const report = detectAnomalies(events, [fw(1, 2), fw(0, 2)], null, { now: NOW, windowDays: 14 });
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
      steady, [], { period: "month", goal: { kind: "tokens", amount: 100_000_000 } },
      { now: NOW, windowDays: 14 },
    );
    const finding = report.findings.find((f) => f.axis === "budget");
    expect(finding).toBeDefined();
    expect(finding?.threshold).toBe(100_000_000);
    expect(finding?.message).toContain("behind budget");
  });

  it("on track → no budget finding; null budget → axis silently skipped", () => {
    const onTrack = detectAnomalies(
      steady, [], { period: "month", goal: { kind: "tokens", amount: 10_000_000 } },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/pro-analytics && npx vitest run test/alerts.test.ts`
Expected: FAIL — `Cannot find module '../src/alerts.js'`

- [ ] **Step 3: Write the implementation**

```ts
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
  budget: "projected savings are behind your budget — run `mega savings forecast` for the pace detail",
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
    findings.length > 0
      ? "alerts"
      : insufficientAxes.length === 4
        ? "insufficient-history"
        : "ok";

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
```

Add to `packages/pro-analytics/src/index.ts`, immediately BEFORE the trailing
`INPUT_PRICE_PER_MTOK_USD` re-export block:

```ts
export {
  type AlertAxis,
  type AlertsReport,
  type AnomalyFinding,
  type StoredBudgetInput,
  ALERT_ADVICE,
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
} from "./alerts.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pro-analytics && npx vitest run`
Expected: PASS (alerts.test.ts green, zero regressions)

- [ ] **Step 5: Commit**

```bash
git add packages/pro-analytics/src/alerts.ts packages/pro-analytics/test/alerts.test.ts packages/pro-analytics/src/index.ts
git commit -m "feat(pro-analytics): anomaly detector — median+MAD spike detection"
```

---

### Task 3: CLI — `mega savings budget set|show|clear`

**Files:**
- Create: `apps/cli/src/commands/savings/budget.ts`
- Create: `apps/cli/test/commands/savings-budget.test.ts` (the savings CLI tests are FLAT in `test/commands/` — `savings.test.ts`, `savings-fix.test.ts` are the neighbors; there is no `test/commands/savings/` directory)
- Modify: `apps/cli/src/commands/savings/index.ts` (register subcommand + re-exports)

**Prebuild:** from the worktree root: `pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/core build` (Task 1's new exports must exist in dist).

- [ ] **Step 1: Write the failing test**

Copy the license harness verbatim from `apps/cli/test/commands/firewall.test.ts:11-50`
(`signTestLicense`, `activatePro`, temp root, out/err arrays), then:

```ts
// apps/cli/test/commands/savings-budget.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetPath, readBudget } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runBudgetClear,
  runBudgetSet,
  runBudgetShow,
} from "../../src/commands/savings/budget.js";
import { PRO_ANALYTICS_UPSELL } from "../../src/commands/savings/shared.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const now = () => Date.UTC(2026, 6, 9, 12, 0, 0);

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-budget-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

const gate = () => ({ storeRoot: root, now, publicKey: keys.publicKey, stdout, stderr });

describe("budget commands — gating", () => {
  it("free tier: upsell, exit 0, nothing written or read", () => {
    expect(runBudgetSet({ ...gate(), value: "$20" })).toBe(0);
    expect(out.join("\n")).toBe(PRO_ANALYTICS_UPSELL);
    expect(existsSync(budgetPath(root))).toBe(false);

    out = [];
    expect(runBudgetShow(gate())).toBe(0);
    expect(out.join("\n")).toBe(PRO_ANALYTICS_UPSELL);

    out = [];
    expect(runBudgetClear(gate())).toBe(0);
    expect(out.join("\n")).toBe(PRO_ANALYTICS_UPSELL);
  });
});

describe("budget set/show/clear — entitled", () => {
  beforeEach(() => activatePro());

  it("set $20 writes a v1 dollars/month budget and show reads it back", () => {
    expect(runBudgetSet({ ...gate(), value: "$20" })).toBe(0);
    expect(readBudget(root)).toEqual({ version: 1, period: "month", kind: "dollars", amount: 20 });
    expect(out.join("\n")).toContain("Budget set: save $20 per month.");

    out = [];
    expect(runBudgetShow(gate())).toBe(0);
    expect(out.join("\n")).toContain("Budget: save $20 per month.");
  });

  it("set 5000000 --period week writes a tokens/week budget", () => {
    expect(runBudgetSet({ ...gate(), value: "5000000", period: "week" })).toBe(0);
    expect(readBudget(root)).toEqual({
      version: 1,
      period: "week",
      kind: "tokens",
      amount: 5_000_000,
    });
  });

  it("rejects bad values and bad periods with stderr + exit 1, writing nothing", () => {
    for (const value of ["abc", "0", "-5", "$0"]) {
      expect(runBudgetSet({ ...gate(), value })).toBe(1);
      expect(existsSync(budgetPath(root))).toBe(false);
    }
    expect(runBudgetSet({ ...gate(), value: "$20", period: "day" })).toBe(1);
    expect(existsSync(budgetPath(root))).toBe(false);
    expect(err.length).toBe(5);
  });

  it("show with no budget prints an honest note, exit 0", () => {
    expect(runBudgetShow(gate())).toBe(0);
    expect(out.join("\n")).toContain("No budget set.");
  });

  it("show with a corrupt file points at the path, exit 1", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    writeFileSync(budgetPath(root), "{broken");
    expect(runBudgetShow(gate())).toBe(1);
    expect(err.join("\n")).toContain("corrupt");
    expect(err.join("\n")).toContain(budgetPath(root));
  });

  it("clear removes the budget and is idempotent", () => {
    runBudgetSet({ ...gate(), value: "$20" });
    expect(runBudgetClear(gate())).toBe(0);
    expect(readBudget(root)).toBeNull();
    expect(runBudgetClear(gate())).toBe(0); // second clear still exit 0
  });

  it("--json contracts: set {budget}, show {status,budget}, clear {cleared}", () => {
    expect(runBudgetSet({ ...gate(), value: "$20", json: true })).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({
      budget: { version: 1, period: "month", kind: "dollars", amount: 20 },
    });
    out = [];
    expect(runBudgetShow({ ...gate(), json: true })).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({
      status: "ok",
      budget: { version: 1, period: "month", kind: "dollars", amount: 20 },
    });
    out = [];
    expect(runBudgetClear({ ...gate(), json: true })).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({ cleared: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && npx vitest run test/commands/savings-budget.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/savings/budget.js'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/cli/src/commands/savings/budget.ts
import type { KeyObject } from "node:crypto";
import {
  type StoredBudget,
  budgetPath,
  budgetStatus,
  clearBudget,
  readBudget,
  writeBudget,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { parseGoal } from "./forecast.js";
import { PRO_ANALYTICS_UPSELL } from "./shared.js";

// The persistent budget is a Pro surface end to end (user decision 2026-07-09):
// even set/show/clear gate first, though they run no Pro compute.
type GateInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function entitled(input: GateInput): boolean {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(PRO_ANALYTICS_UPSELL);
    return false;
  }
  return true;
}

function formatGoalAmount(kind: "tokens" | "dollars", amount: number): string {
  return kind === "dollars" ? `$${amount}` : `${amount} tokens`;
}

export type RunBudgetSetInput = GateInput & { value: string; period?: string; json?: boolean };

export function runBudgetSet(input: RunBudgetSetInput): 0 | 1 {
  if (!entitled(input)) return 0;
  const goal = parseGoal(input.value);
  if (goal === null) {
    input.stderr(
      `Invalid budget ${input.value}: expected a positive number of tokens or $dollars.`,
    );
    return 1;
  }
  const period = input.period ?? "month";
  if (period !== "month" && period !== "week") {
    input.stderr(`Invalid --period ${period}: expected month or week.`);
    return 1;
  }
  const budget: StoredBudget = { version: 1, period, kind: goal.kind, amount: goal.amount };
  writeBudget(input.storeRoot, budget);
  if (input.json) {
    input.stdout(JSON.stringify({ budget }));
    return 0;
  }
  input.stdout(`Budget set: save ${formatGoalAmount(goal.kind, goal.amount)} per ${period}.`);
  return 0;
}

export type RunBudgetShowInput = GateInput & { json?: boolean };

export function runBudgetShow(input: RunBudgetShowInput): 0 | 1 {
  if (!entitled(input)) return 0;
  const status = budgetStatus(input.storeRoot);
  if (status === "corrupt") {
    if (input.json) {
      input.stdout(JSON.stringify({ status, budget: null }));
      return 1;
    }
    input.stderr(
      `budget.json is corrupt at ${budgetPath(input.storeRoot)} — run \`mega savings budget clear\`.`,
    );
    return 1;
  }
  const budget = status === "ok" ? readBudget(input.storeRoot) : null;
  if (input.json) {
    input.stdout(JSON.stringify({ status, budget }));
    return 0;
  }
  if (budget === null) {
    input.stdout("No budget set. Set one: mega savings budget set $20 --period month");
    return 0;
  }
  input.stdout(
    `Budget: save ${formatGoalAmount(budget.kind, budget.amount)} per ${budget.period}.`,
  );
  return 0;
}

export type RunBudgetClearInput = GateInput & { json?: boolean };

export function runBudgetClear(input: RunBudgetClearInput): 0 | 1 {
  if (!entitled(input)) return 0;
  clearBudget(input.storeRoot);
  if (input.json) {
    input.stdout(JSON.stringify({ cleared: true }));
    return 0;
  }
  input.stdout("Budget cleared.");
  return 0;
}

const COMMON_ARGS = {
  json: { type: "boolean", default: false, description: "Emit JSON output." },
  store: { type: "string", description: "Override store directory." },
} as const;

function wire(args: Record<string, unknown>): Omit<GateInput, "stdout" | "stderr"> {
  return {
    storeRoot: resolveStorePath(
      readStoreEnv(typeof args["store"] === "string" ? args["store"] : undefined),
    ),
    now: () => Date.now(),
  };
}

const io = {
  stdout: (line: string) => console.log(line),
  stderr: (line: string) => console.error(line),
};

export const savingsBudgetCommand = defineCommand({
  meta: {
    name: "budget",
    description: "Set / show / clear the persistent savings budget (Mega Saver Pro).",
  },
  subCommands: {
    set: defineCommand({
      meta: { name: "set", description: "Set the budget: <tokens> or $<dollars>." },
      args: {
        value: {
          type: "positional",
          required: true,
          description: "<tokens> or $<dollars> (e.g. 5000000 or $20).",
        },
        period: { type: "string", description: "month | week (default: month)." },
        ...COMMON_ARGS,
      },
      run({ args }) {
        const code = runBudgetSet({
          ...wire(args),
          ...io,
          value: String(args.value),
          ...(typeof args.period === "string" ? { period: args.period } : {}),
          json: !!args.json,
        });
        if (code !== 0) process.exitCode = code;
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show the stored budget." },
      args: { ...COMMON_ARGS },
      run({ args }) {
        const code = runBudgetShow({ ...wire(args), ...io, json: !!args.json });
        if (code !== 0) process.exitCode = code;
      },
    }),
    clear: defineCommand({
      meta: { name: "clear", description: "Remove the stored budget." },
      args: { ...COMMON_ARGS },
      run({ args }) {
        const code = runBudgetClear({ ...wire(args), ...io, json: !!args.json });
        if (code !== 0) process.exitCode = code;
      },
    }),
  },
});
```

In `apps/cli/src/commands/savings/index.ts`: import + register
`budget: savingsBudgetCommand` in `subCommands`, and add the re-export block:

```ts
export {
  type RunBudgetClearInput,
  type RunBudgetSetInput,
  type RunBudgetShowInput,
  runBudgetClear,
  runBudgetSet,
  runBudgetShow,
  savingsBudgetCommand,
} from "./budget.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && npx vitest run test/commands/savings-budget.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/savings/budget.ts apps/cli/test/commands/savings-budget.test.ts apps/cli/src/commands/savings/index.ts
git commit -m "feat(cli): mega savings budget set/show/clear"
```

---

### Task 4: CLI — `mega alerts` + registration

**Files:**
- Create: `apps/cli/src/commands/alerts.ts`
- Create: `apps/cli/test/commands/alerts.test.ts`
- Modify: `apps/cli/src/main.ts` (import + register `alerts: alertsCommand` in the subCommands map, alphabetically before `cache`)

**Prebuild:** `pnpm --filter @megasaver/pro-analytics build` (Task 2's detector must exist in dist).

- [ ] **Step 1: Write the failing test**

Same license harness as Task 3. Key cases (write them all):

```ts
// apps/cli/test/commands/alerts.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERTS_UPSELL, runAlerts } from "../../src/commands/alerts.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;
const DAY = 86_400_000;

let seq = 0;
function ev(daysAgo: number, rawBytes: number, label = "read") {
  const bytesSaved = Math.floor(rawBytes / 2);
  return {
    id: `e${seq++}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: new Date(NOW_MS - daysAgo * DAY).toISOString(),
    sourceKind: "file",
    label,
    rawBytes,
    returnedBytes: rawBytes - bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "",
    mode: "safe",
  } as never;
}

// 14 quiet days + a 2M-token spike today (same series the detector tests use).
function spikeEvents() {
  const events = [];
  for (let i = 1; i <= 14; i++) events.push(ev(i, 400_000));
  events.push(ev(0, 8_000_000));
  return events;
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-alerts-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

function run(over: {
  events?: unknown[];
  log?: string | null;
  budget?: { status: "absent" | "ok" | "corrupt"; budget: unknown };
  days?: string;
  json?: boolean;
} = {}) {
  const readAllEvents = vi.fn(async () => ({
    events: (over.events ?? []) as never[],
    eventsByProject: {},
  }));
  const readFirewallLog = vi.fn(() => over.log ?? null);
  const readStoredBudget = vi.fn(
    () => (over.budget ?? { status: "absent" as const, budget: null }) as never,
  );
  const code = runAlerts({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readAllEvents,
    readFirewallLog,
    readStoredBudget,
    ...(over.days !== undefined ? { days: over.days } : {}),
    ...(over.json !== undefined ? { json: over.json } : {}),
    stdout,
    stderr,
  });
  return { code, readAllEvents, readFirewallLog, readStoredBudget };
}

describe("runAlerts — gating", () => {
  it("free tier: upsell, exit 0, nothing read (plain, --json, --days variants)", async () => {
    for (const over of [{}, { json: true }, { days: "14" }] as const) {
      out = [];
      const { code, readAllEvents, readFirewallLog, readStoredBudget } = run(over);
      expect(await code).toBe(0);
      expect(out.join("\n")).toBe(ALERTS_UPSELL);
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(readFirewallLog).not.toHaveBeenCalled();
      expect(readStoredBudget).not.toHaveBeenCalled();
    }
  });
});

describe("runAlerts — entitled", () => {
  beforeEach(() => activatePro());

  it("planted traffic spike → finding line + advice, exit 0", async () => {
    const { code } = run({ events: spikeEvents() });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("[traffic]");
    expect(text).toContain("fix: context traffic spiked");
  });

  it("--json is the stable AlertsReport contract", async () => {
    const { code } = run({ events: spikeEvents(), json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("alerts");
    expect(report.windowDays).toBe(30);
    expect(report.findings[0].axis).toBe("traffic");
  });

  it("insufficient history → honest line, exit 0", async () => {
    const { code } = run({ events: [ev(2, 400_000)] });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("Not enough history yet");
  });

  it("quiet store with history → 'No anomalies' + skipped-axes note", async () => {
    // --days 14 matters: under the default 30-day window the baseline would be
    // zero-padded (16 empty days), median 0, floor threshold 50k — and a steady
    // 100k-token day would "spike". With a 14-day window the baseline is flat
    // 100k, fallback threshold max(4×100k, 50k) = 400k, today 100k is quiet.
    const events = [];
    for (let i = 1; i <= 14; i++) events.push(ev(i, 400_000));
    events.push(ev(0, 400_000));
    const { code } = run({ events, days: "14" });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("No anomalies in the last 14 days.");
    expect(text).toContain("firewall"); // no ledger → skipped note
  });

  it("firewall ledger lines are parsed and drive the firewall axis", async () => {
    const lines = [];
    for (let i = 1; i <= 14; i++) {
      lines.push(
        JSON.stringify({
          at: new Date(NOW_MS - i * DAY).toISOString(),
          kind: "redacted",
          detector: "credit_card",
          count: 1,
        }),
      );
    }
    lines.push(
      JSON.stringify({
        at: new Date(NOW_MS).toISOString(),
        kind: "redacted",
        detector: "credit_card",
        count: 12,
      }),
    );
    lines.push("{corrupt tail"); // must not kill the report
    const { code } = run({ log: lines.join("\n"), days: "14" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("[firewall]");
  });

  it("stored budget behind pace → budget finding", async () => {
    const events = [];
    for (let i = 1; i <= 14; i++) events.push(ev(i, 8_000_000)); // 1M saved tokens/day
    const { code } = run({
      events,
      budget: {
        status: "ok",
        budget: { version: 1, period: "month", kind: "tokens", amount: 100_000_000 },
      },
    });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("[budget]");
  });

  it("corrupt budget.json → stderr note, budget axis skipped, exit 0", async () => {
    const { code } = run({
      events: spikeEvents(),
      budget: { status: "corrupt", budget: null },
    });
    expect(await code).toBe(0);
    expect(err.join("\n")).toContain("corrupt");
    expect(out.join("\n")).not.toContain("[budget]");
  });

  it("bad --days → stderr + exit 1", async () => {
    for (const days of ["0", "-3", "abc", "3651", "1.5"]) {
      err = [];
      const { code } = run({ days });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("Invalid --days");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && npx vitest run test/commands/alerts.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/alerts.js'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/cli/src/commands/alerts.ts
import type { KeyObject } from "node:crypto";
import { type FirewallEvent, firewallEventSchema } from "@megasaver/context-gate";
import { type StoredBudget, budgetStatus, readBudget } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { defaultReadFirewallLog } from "./firewall.js";
import {
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./savings/index.js";

export const ALERTS_UPSELL = `Anomaly alerts are a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Boundary parse (§8): same local shape as cache.ts/firewall.ts (3 similar
// lines > premature abstraction); 3650 cap keeps date math in range.
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

export type ReadStoredBudget = (storeRoot: string) => {
  status: "absent" | "ok" | "corrupt";
  budget: StoredBudget | null;
};

const defaultReadStoredBudget: ReadStoredBudget = (root) => ({
  status: budgetStatus(root),
  budget: readBudget(root),
});

export type RunAlertsInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  readAllEvents: SavingsEventReader;
  readFirewallLog: (storeRoot: string) => string | null;
  readStoredBudget?: ReadStoredBudget;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAlerts(input: RunAlertsInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(ALERTS_UPSELL);
    return 0;
  }

  let days: number | undefined;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr(
        `Invalid --days ${input.days}: expected a whole number of days between 1 and 3650.`,
      );
      return 1;
    }
    days = parsed;
  }

  const raw = input.readFirewallLog(input.storeRoot);
  const fwEvents: FirewallEvent[] = [];
  for (const line of raw === null ? [] : raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed);
    } catch {
      continue; // corrupt tail from a crashed writer must not kill the report
    }
    const result = firewallEventSchema.safeParse(parsedLine);
    if (result.success) fwEvents.push(result.data);
  }

  const budgetRead = (input.readStoredBudget ?? defaultReadStoredBudget)(input.storeRoot);
  let budget: { period: "month" | "week"; goal: { kind: "tokens" | "dollars"; amount: number } } | null =
    null;
  if (budgetRead.status === "corrupt") {
    input.stderr(
      "stored budget unreadable (corrupt budget.json) — skipping the budget check; run `mega savings budget clear`.",
    );
  } else if (budgetRead.budget !== null) {
    budget = {
      period: budgetRead.budget.period,
      goal: { kind: budgetRead.budget.kind, amount: budgetRead.budget.amount },
    };
  }

  // Lazy import after the gate: never load the Pro compute on the free path.
  const { ALERT_MIN_HISTORY_DAYS, detectAnomalies } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const report = detectAnomalies(events, fwEvents, budget, {
    now: input.now(),
    ...(days === undefined ? {} : { windowDays: days }),
  });

  // --json is a stable contract: ALWAYS JSON, including the empty case.
  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (report.status === "insufficient-history") {
    input.stdout(
      `Not enough history yet (${report.historyDays.events} days recorded; needs ${ALERT_MIN_HISTORY_DAYS}).`,
    );
    return 0;
  }

  if (report.findings.length === 0) {
    input.stdout(`No anomalies in the last ${report.windowDays} days.`);
    if (report.insufficientAxes.length > 0) {
      input.stdout(`insufficient history (skipped): ${report.insufficientAxes.join(", ")}`);
    }
    return 0;
  }

  input.stdout(`Context alerts — last ${report.windowDays} days`);
  input.stdout("");
  for (const f of report.findings) {
    input.stdout(`  [${f.axis}] ${f.message}`);
  }
  if (report.insufficientAxes.length > 0) {
    input.stdout("");
    input.stdout(`insufficient history (skipped): ${report.insufficientAxes.join(", ")}`);
  }
  input.stdout("");
  for (const a of report.advice) {
    input.stdout(`fix: ${a}`);
  }
  return 0;
}

export const alertsCommand = defineCommand({
  meta: {
    name: "alerts",
    description:
      "Anomaly alerts — traffic/source/ratio/firewall spikes + budget pace (Mega Saver Pro).",
  },
  args: {
    days: { type: "string", description: "Window in days (default 30, max 3650)." },
    json: { type: "boolean", default: false, description: "Emit the AlertsReport as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runAlerts({
      storeRoot,
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(storeInput),
      readFirewallLog: defaultReadFirewallLog,
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

In `apps/cli/src/main.ts`: add `import { alertsCommand } from "./commands/alerts.js";`
(alphabetical import order) and `alerts: alertsCommand,` in the subCommands map
(before `cache: cacheCommand`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && npx vitest run test/commands/alerts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/alerts.ts apps/cli/test/commands/alerts.test.ts apps/cli/src/main.ts
git commit -m "feat(cli): mega alerts — anomaly alert report"
```

---

### Task 5: Forecast auto-loads the stored budget

**Files:**
- Modify: `apps/cli/src/commands/savings/forecast.ts`
- Modify: `apps/cli/test/commands/savings.test.ts` — the forecast CLI tests live
  INSIDE this shared suite (describe blocks around lines 573 and 620; there is
  no per-command forecast test file). The suite already has: `signTestLicense`,
  `activatePro()` (line ~119), `event(createdAt, bytesSaved)` fixture,
  `NOW_MS = 1_700_000_000_000` (2023-11-14T22:13:20Z — November 2023),
  `forecastEvents` (two Nov-2023 events) + `forecastReader()`, `out`/`err`
  arrays, and a hoisted `proSpies` `vi.mock` of `@megasaver/pro-analytics` that
  DELEGATES to the real implementations — rendered values are real.

- [ ] **Step 1: Write the failing tests (append to `savings.test.ts`)**

Append this describe block after the existing
`"runSavingsForecast — render variants (entitled)"` block, reusing the suite's
helpers verbatim:

```ts
describe("runSavingsForecast — stored budget auto-load (1.13)", () => {
  const stored = {
    status: "ok" as const,
    budget: {
      version: 1 as const,
      period: "week" as const,
      kind: "dollars" as const,
      amount: 20,
    },
  };
  const absent = { status: "absent" as const, budget: null };

  // NOW_MS is Tue 2023-11-14T22:13:20Z; the current Monday-based week starts
  // Mon 2023-11-13. The suite's forecastEvents (Nov 5/10) fall BEFORE that
  // week — with the stored "week" period they'd yield savedSoFar 0 and the
  // early "No savings recorded" return, never the pace line. The stored-budget
  // tests therefore use a week-fresh event.
  const weekEvents: TokenSaverEvent[] = [event("2023-11-14T00:00:00.000Z", 4_000_000)];
  const weekReader: SavingsEventReader = () => ({
    events: weekEvents,
    eventsByProject: { "proj-1": weekEvents },
  });

  it("free tier: readStoredBudget is never invoked (gate first)", async () => {
    const readStoredBudget = vi.fn(() => stored);
    const code = await runSavingsForecast({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: vi.fn(forecastReader()),
      readStoredBudget,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Mega Saver Pro");
    expect(readStoredBudget).not.toHaveBeenCalled();
  });

  describe("entitled", () => {
    beforeEach(() => activatePro());

    it("no flags → stored budget supplies goal AND period, marker shown", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: weekReader,
        readStoredBudget: () => stored,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("this week"); // period came from the store
      expect(text).toContain("stored budget"); // marker replaces the word "goal"
      expect(proSpies.budgetPace).toHaveBeenCalledTimes(1);
    });

    it("explicit --goal wins over the stored budget", async () => {
      // period still auto-loads from the store ("week") → needs in-week savings
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: weekReader,
        readStoredBudget: () => stored,
        goal: "$50",
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("$50");
      expect(text).toContain("goal");
      expect(text).not.toContain("stored budget");
    });

    it("explicit --period wins over the stored period", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => stored,
        period: "month",
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("this month");
    });

    it("--json gains goalSource ('stored' vs 'flag') when a pace exists", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: weekReader,
        readStoredBudget: () => stored,
        json: true,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(out.join("\n")) as { goalSource: string; pace: unknown };
      expect(parsed.goalSource).toBe("stored");
      expect(parsed.pace).toBeDefined();

      out.length = 0;
      await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => absent,
        goal: "$50",
        json: true,
        stdout,
        stderr,
      });
      expect((JSON.parse(out.join("\n")) as { goalSource: string }).goalSource).toBe("flag");
    });

    it("no flags + absent stored budget → plain forecast, unchanged behavior", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => absent,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("this month");
      expect(text).not.toContain("% of your");
      expect(proSpies.budgetPace).not.toHaveBeenCalled();
    });

    it("corrupt stored budget → stderr note, forecast proceeds without a pace", async () => {
      const code = await runSavingsForecast({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents: forecastReader(),
        readStoredBudget: () => ({ status: "corrupt" as const, budget: null }),
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(err.join("\n")).toContain("corrupt");
      expect(out.join("\n")).not.toContain("% of your");
    });
  });
});
```

Note: the pre-existing forecast tests pass no `readStoredBudget`, so the
default implementation reads the real (empty temp) store → absent → behavior
unchanged. Do NOT edit them.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd apps/cli && npx vitest run test/commands/savings.test.ts`
Expected: new tests FAIL (`readStoredBudget` is not a known input / marker
missing); all pre-existing tests PASS

- [ ] **Step 3: Modify `runSavingsForecast`**

Exact edits to `apps/cli/src/commands/savings/forecast.ts`:

1. Extend the core import (line 2) and add the type:

```ts
import { type StoredBudget, budgetStatus, formatDollarsSaved, readBudget } from "@megasaver/core";
```

2. Add to `RunSavingsForecastInput`:

```ts
  readStoredBudget?: (storeRoot: string) => {
    status: "absent" | "ok" | "corrupt";
    budget: StoredBudget | null;
  };
```

3. After the `--goal` parse block (line 60) and before the lazy import, insert:

```ts
  // Stored-budget auto-load (1.13): explicit flags always win; the stored
  // budget only fills the gaps. Corrupt file → honest note, treated as absent.
  let goalSource: "flag" | "stored" | null = goal === null ? null : "flag";
  let storedPeriod: ForecastPeriodArg | undefined;
  if (goal === null || input.period === undefined) {
    const readStored =
      input.readStoredBudget ??
      ((root: string) => ({ status: budgetStatus(root), budget: readBudget(root) }));
    const storedRead = readStored(input.storeRoot);
    if (storedRead.status === "corrupt") {
      input.stderr(
        "stored budget unreadable (corrupt budget.json) — ignoring; run `mega savings budget clear`.",
      );
    } else if (storedRead.budget !== null) {
      if (goal === null) {
        goal = { kind: storedRead.budget.kind, amount: storedRead.budget.amount };
        goalSource = "stored";
      }
      if (input.period === undefined) {
        storedPeriod = storedRead.budget.period;
      }
    }
  }
```

4. Change the period line (old line 64) to:

```ts
  const period: ForecastPeriodArg = input.period ?? storedPeriod ?? "month";
```

5. Change the JSON line (old line 69) to:

```ts
    input.stdout(JSON.stringify(pace ? { forecast, pace, goalSource } : { forecast }));
```

6. Change the headline pace segment (old line 86) to:

```ts
    headline += ` — ${pct}% of your ${goalStr} ${goalSource === "stored" ? "stored budget" : "goal"} (${pace.onTrack ? "on track" : "behind"})`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && npx vitest run test/commands/savings.test.ts`
Expected: PASS (new + all pre-existing)

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/savings/forecast.ts apps/cli/test/commands/savings.test.ts
git commit -m "feat(cli): savings forecast auto-loads the stored budget"
```

---

### Task 6: Docs, changeset, wiki, verify, smoke

**Files:**
- Modify: `README.md` (command table + Pro section)
- Create: `.changeset/anomaly-alerts-budgets.md`
- Modify: `wiki/entities/cli.md`, `wiki/syntheses/pro-differentiation-portfolio.md`, `wiki/log.md`

- [ ] **Step 1: README**

In the command table (after the `mega firewall` row, README.md:528):

```markdown
| `mega alerts` | anomaly alerts — traffic/source/ratio/firewall spikes + budget pace (Pro) |
```

In the `## Pro` section list of Pro features, add bullets for `mega alerts` and
`mega savings budget set|show|clear` (+ note that `mega savings forecast` now
auto-loads the stored budget). Match the surrounding bullet style.

- [ ] **Step 2: Changeset**

```markdown
---
"@megasaver/cli": minor
---

`mega alerts` — deterministic anomaly alerts over the savings + firewall
streams (median+MAD spike detection: daily traffic, per-source, saving-ratio
collapse, firewall-event surge, plus budget pace) — and `mega savings budget
set|show|clear`, a persistent stats/budget.json savings goal.
`mega savings forecast` now auto-loads the stored budget (explicit flags win;
the pace line says "stored budget"; `--json` adds `goalSource`).
```

- [ ] **Step 3: Wiki**

- `wiki/entities/cli.md`: add `mega alerts` + `mega savings budget` to the
  command inventory with one-line descriptions.
- `wiki/syntheses/pro-differentiation-portfolio.md`: update the Status section —
  1.13 (N7) shipped; next: 2.0 portable project brain.
- `wiki/log.md`: append a timestamped `## [2026-07-09] feat | 1.13 anomaly
  alerts + persistent budgets` entry (spec/plan paths, key decisions, PR ref).

- [ ] **Step 4: Full verify**

Run from the worktree root: `pnpm verify`
Expected: green (lint + typecheck + all suites + conventions:check). If the CLI
suite fails on missing dist exports, run a clean `pnpm build` first (known
turbo-cache quirk) and re-run.

- [ ] **Step 5: E2E smoke (capture the terminal session)**

The spec requires the smoke to show (a) the `(stored budget)`-marked pace line
in `forecast` and (b) a planted-spike finding in `alerts` — both need real
data in the store, so the smoke plants it: a registry project + session via
the CLI, then schema-valid event lines appended to the store's JSONL files
(`stats/<projectId>/<sessionId>.events.jsonl` savings events;
`firewall/events.jsonl` firewall events — both plain JSONL the CLI reads back
through its normal paths).

```bash
STORE=$(mktemp -d)
MEGA="node apps/cli/dist/main.mjs"
KEY=$(node scripts/license/issue.mjs smoke-113)   # signs with the owner's offline private key
$MEGA license activate "$KEY" --store "$STORE"
$MEGA savings budget set '$20' --period month --store "$STORE"   # → Budget set: save $20 per month.
$MEGA savings budget show --store "$STORE"                        # → Budget: save $20 per month.

# Plant: project + session + 15 days of savings events (spike today) + firewall surge today.
# create --json prints the created object FLAT: {id, name, ...} / {id, projectId, ...}
PID=$($MEGA project create smoke-113 --store "$STORE" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
SID=$($MEGA session create smoke-113 --agent claude-code --store "$STORE" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
STORE="$STORE" PID="$PID" SID="$SID" node --input-type=module -e '
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const { STORE, PID, SID } = process.env;
const DAY = 86_400_000, now = Date.now();
const evPath = join(STORE, "stats", PID, `${SID}.events.jsonl`);
mkdirSync(join(STORE, "stats", PID), { recursive: true });
for (let i = 15; i >= 0; i--) {
  const raw = i === 0 ? 8_000_000 : 400_000;             // today spikes 20×
  const saved = raw / 2;
  appendFileSync(evPath, `${JSON.stringify({
    id: `smoke-${i}`, sessionId: SID, projectId: PID,
    createdAt: new Date(now - i * DAY).toISOString(),
    sourceKind: "file", label: "read", rawBytes: raw,
    returnedBytes: raw - saved, bytesSaved: saved,
    savingRatio: 0.5, summary: "smoke", mode: "safe",
  })}\n`);
}
const fwPath = join(STORE, "firewall", "events.jsonl");
mkdirSync(join(STORE, "firewall"), { recursive: true });
for (let i = 15; i >= 0; i--) {
  appendFileSync(fwPath, `${JSON.stringify({
    at: new Date(now - i * DAY).toISOString(), kind: "redacted",
    detector: "credit_card", count: i === 0 ? 12 : 1,
  })}\n`);
}
console.log("planted 16 savings days + 16 firewall days (spikes today)");
'

$MEGA savings forecast --store "$STORE"    # → pace line "…% of your $20.00 stored budget (…)"
$MEGA alerts --store "$STORE"              # → [traffic] + [firewall] findings + fix: lines
$MEGA alerts --store "$STORE" --json | head -c 400   # → stable AlertsReport JSON
$MEGA savings budget clear --store "$STORE"          # → Budget cleared.

FREE_STORE=$(mktemp -d)
$MEGA alerts --store "$FREE_STORE"                    # → Pro upsell
$MEGA savings budget set '$20' --store "$FREE_STORE"  # → Pro upsell
```

Expected: every annotated line renders as stated — notably the
`stored budget` marker in the forecast pace line and at least the `[traffic]`
and `[firewall]` findings in `alerts`. Capture the session into the PR
description.

- [ ] **Step 6: Commit**

```bash
git add README.md .changeset/anomaly-alerts-budgets.md wiki/
git commit -m "docs(release): 1.13 anomaly alerts — README, changeset, wiki"
```

---

## Post-plan gates (process, not tasks)

1. **Review (§9.6, MEDIUM):** fresh-context `code-reviewer` pass AND a separate
   `critic` pass (mutation-test the detector guards: flip a threshold
   comparison, drop the today-exclusion, drop a floor — a test must fail for
   each). Fix findings red-first.
2. **PR:** branch `feat/cli-anomaly-alerts` → PR → CI green (ubuntu + windows)
   → rebase-merge.
3. **Release:** standard ritual — changeset version PR → tag `v1.13.0` → CI
   auto-publishes (NO manual npm publish); post-publish smoke from the
   published tarball.
