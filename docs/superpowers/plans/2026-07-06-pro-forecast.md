# Pro module 3 — savings budget & forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD. Build touched packages after src edits. `pnpm verify` at slice boundaries. Risk MEDIUM → code-reviewer + critic.

**Goal:** A third proprietary Pro module — `mega savings forecast` — that projects the current period's end-of-period savings by run-rate and paces it against an optional `--goal`, on the same offline-license entitlement, reusing module 1/2's gated-command pattern.

**Architecture:** Two pure functions in `packages/pro-analytics` consume already-validated `TokenSaverEvent`s + an injected `now` and return a run-rate `SavingsForecast` + an optional `BudgetPace`. A new gated CLI command mirrors `runSavingsHistory`. No change to `@megasaver/entitlement`. No persistence — the goal is a CLI flag.

**Tech Stack:** TypeScript ESM, Vitest, Citty. Packages: `packages/pro-analytics`, `apps/cli`. Reuses `@megasaver/stats` (`tokensFromBytes`, `INPUT_PRICE_PER_MTOK_USD`, `TokenSaverEvent`), `@megasaver/core` (`formatDollarsSaved`), `@megasaver/entitlement` (`checkEntitlement`).

**Spec:** `docs/superpowers/specs/2026-07-06-pro-forecast-design.md`.

**Anchors:**
- `packages/pro-analytics/src/insights.ts` / `history.ts` — the pure-fn style (`dollarsFromTokens`, aggregate then map).
- `packages/pro-analytics/src/index.ts` — the export surface.
- `apps/cli/src/commands/savings/history.ts` — the gated-command template.
- `apps/cli/src/commands/savings/shared.ts` — `PRO_ANALYTICS_UPSELL`, `defaultSavingsEventReader`.
- `apps/cli/src/commands/savings/index.ts` — the `savings` group registration.
- `apps/cli/test/commands/savings.test.ts` — the gated-command test patterns (the `proSpies` + `vi.mock` block, `signTestLicense`, `activatePro`, `keys`, `root`, `stdout/stderr`).

---

## Slice A — `pro-analytics` forecast (proprietary, pure)

### Task A1: `forecastSavings`

**Files:**
- Create: `packages/pro-analytics/src/forecast.ts`
- Modify: `packages/pro-analytics/src/index.ts`
- Test: `packages/pro-analytics/test/forecast.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/pro-analytics/test/forecast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { forecastSavings } from "../src/forecast.js";

// tokensFromBytes is bytes/4 (see @megasaver/stats); 4_000_000 bytes → 1_000_000 tokens.
function ev(createdAt: string, bytesSaved: number, i: number) {
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt,
    sourceKind: "file",
    label: "read",
    rawBytes: bytesSaved * 2,
    returnedBytes: bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "",
    mode: "safe",
  } as never;
}

const NOW = Date.UTC(2026, 6, 15, 0, 0, 0); // 2026-07-15T00:00:00Z, mid-July (31-day month)

describe("forecastSavings — month", () => {
  it("sums in-period savings and projects by run-rate", () => {
    const events = [
      ev("2026-07-05T00:00:00.000Z", 4_000_000, 0), // in period → 1_000_000 tokens
      ev("2026-07-10T00:00:00.000Z", 4_000_000, 1), // in period → 1_000_000 tokens
      ev("2026-06-30T00:00:00.000Z", 20_000_000, 2), // before periodStart → excluded
      ev("2026-07-20T00:00:00.000Z", 40_000_000, 3), // after now → excluded
    ];
    const f = forecastSavings(events, { now: NOW, period: "month" });
    expect(f.period).toBe("month");
    expect(f.savedSoFar.bytes).toBe(8_000_000);
    expect(f.savedSoFar.tokens).toBe(2_000_000);
    expect(f.elapsedDays).toBeCloseTo(14);
    expect(f.totalDays).toBeCloseTo(31);
    expect(f.daysLeft).toBeCloseTo(17);
    // run-rate: 2_000_000 tokens over 14 days → × 31/14 at month end.
    expect(f.projectedEnd.tokens).toBeCloseTo(2_000_000 * (31 / 14));
    expect(Number.isFinite(f.projectedEnd.dollars)).toBe(true);
  });

  it("elapsedMs<=0 (now === periodStart) → projectedEnd == savedSoFar, no NaN", () => {
    const start = Date.UTC(2026, 6, 1, 0, 0, 0);
    const events = [ev("2026-07-01T00:00:00.000Z", 4_000_000, 0)]; // exactly at periodStart, included
    const f = forecastSavings(events, { now: start, period: "month" });
    expect(f.savedSoFar.tokens).toBe(1_000_000);
    expect(f.projectedEnd.tokens).toBe(f.savedSoFar.tokens);
    expect(f.dailyRate.tokens).toBe(0);
    expect(Number.isNaN(f.projectedEnd.tokens)).toBe(false);
  });

  it("empty events → zeros, no NaN", () => {
    const f = forecastSavings([], { now: NOW, period: "month" });
    expect(f.savedSoFar.tokens).toBe(0);
    expect(f.projectedEnd.tokens).toBe(0);
    expect(Number.isNaN(f.projectedEnd.dollars)).toBe(false);
  });
});

describe("forecastSavings — week", () => {
  it("uses a Monday-based window and excludes out-of-week events", () => {
    // 2026-07-15 is a Wednesday; the ISO week starts Monday 2026-07-13T00:00Z.
    const events = [
      ev("2026-07-13T06:00:00.000Z", 4_000_000, 0), // Monday, in week
      ev("2026-07-14T06:00:00.000Z", 4_000_000, 1), // Tuesday, in week
      ev("2026-07-12T06:00:00.000Z", 40_000_000, 2), // previous Sunday → excluded
    ];
    const f = forecastSavings(events, { now: NOW, period: "week" });
    expect(f.period).toBe("week");
    expect(f.totalDays).toBeCloseTo(7);
    expect(f.savedSoFar.tokens).toBe(2_000_000); // the two in-week events only
    expect(f.projectedEnd.tokens).toBeGreaterThan(f.savedSoFar.tokens);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @megasaver/pro-analytics test forecast` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `packages/pro-analytics/src/forecast.ts`:

```ts
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
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @megasaver/pro-analytics test forecast`.

- [ ] **Step 5: Commit** `feat(pro-analytics): run-rate savings forecast`.

### Task A2: `budgetPace` + export

**Files:**
- Modify: `packages/pro-analytics/src/forecast.ts`, `packages/pro-analytics/src/index.ts`
- Test: `packages/pro-analytics/test/forecast.test.ts`

- [ ] **Step 1: Write the failing test** — append to `forecast.test.ts`:

```ts
import { budgetPace, type SavingsForecast } from "../src/forecast.js";

function fc(overrides: Partial<SavingsForecast> = {}): SavingsForecast {
  return {
    period: "month",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    elapsedDays: 14,
    totalDays: 31,
    daysLeft: 17,
    savedSoFar: { bytes: 16_000_000, tokens: 4_000_000, dollars: 12 },
    dailyRate: { tokens: 0, dollars: 0 },
    projectedEnd: { tokens: 8_000_000, dollars: 24 },
    ...overrides,
  };
}

describe("budgetPace", () => {
  it("dollars goal — pct + onTrack", () => {
    const p = budgetPace(fc(), { kind: "dollars", amount: 20 });
    expect(p.pctOfGoalSoFar).toBeCloseTo(12 / 20);
    expect(p.pctOfGoalProjected).toBeCloseTo(24 / 20);
    expect(p.onTrack).toBe(true); // projected 24 >= 20
  });

  it("dollars goal — behind when projected < goal", () => {
    const p = budgetPace(fc(), { kind: "dollars", amount: 30 });
    expect(p.onTrack).toBe(false);
  });

  it("tokens goal uses token fields", () => {
    const p = budgetPace(fc(), { kind: "tokens", amount: 10_000_000 });
    expect(p.pctOfGoalProjected).toBeCloseTo(8_000_000 / 10_000_000);
    expect(p.onTrack).toBe(false);
  });

  it("amount<=0 → 0, no NaN", () => {
    const p = budgetPace(fc(), { kind: "dollars", amount: 0 });
    expect(p.pctOfGoalSoFar).toBe(0);
    expect(p.pctOfGoalProjected).toBe(0);
    expect(Number.isNaN(p.pctOfGoalProjected)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — append to `forecast.ts`:

```ts
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
```

Then update `packages/pro-analytics/src/index.ts` to add:

```ts
export {
  type ForecastPeriod,
  type SavingsForecast,
  type BudgetGoal,
  type BudgetPace,
  forecastSavings,
  budgetPace,
} from "./forecast.js";
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @megasaver/pro-analytics build && pnpm --filter @megasaver/pro-analytics test`.

- [ ] **Step 5: Commit** `feat(pro-analytics): budget pace vs savings goal`.

**Slice A boundary:** `pnpm --filter @megasaver/pro-analytics build` + test green.

---

## Slice B — gated `mega savings forecast`

### Task B1: `runSavingsForecast` (TDD)

**Files:**
- Create: `apps/cli/src/commands/savings/forecast.ts`
- Modify: `apps/cli/src/commands/savings/index.ts`
- Test: `apps/cli/test/commands/savings.test.ts`

- [ ] **Step 1: Write the failing test** — add a `forecast` block to `apps/cli/test/commands/savings.test.ts`.

  **Extend the existing `proSpies` + `vi.mock("@megasaver/pro-analytics")` block** to add `forecastSavings: vi.fn()` and `budgetPace: vi.fn()` (each `mockImplementation(actual.…)` + spread), mirroring the history/insights spies — required for the "upsell computes nothing" assertion. Import `runSavingsForecast` from `../../src/commands/savings/index.js`. Use a fixed `now` (the file already defines `NOW_MS`/`now`) and a `readAllEvents` stub returning events dated within the `now` month so the projection is non-zero (e.g. two events earlier in the same month as `now`).

  Assertions:
  - no license → stdout has the upsell; returns 0; `readAllEvents`, `proSpies.forecastSavings`, `proSpies.budgetPace` all NOT called.
  - valid license (call `activatePro()`) → stdout contains "on pace" / a projected `$` figure and "(est.)"; returns 0.
  - `--goal $10` → stdout contains a `%` pace figure; `proSpies.budgetPace` called once.
  - `--json` → parsed stdout is `{ forecast: {...}, pace: {...} }` (pace present with a goal).
  - `--goal abc` and `--goal 0` and `--goal -5` → stderr error, returns 1, no render.
  - events all outside the current period (e.g. dated last year) → "No savings recorded this month yet." (or the empty-period line), returns 0.

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @megasaver/cli test savings` — Expected: FAIL (`runSavingsForecast` not found).

- [ ] **Step 3: Implement** `apps/cli/src/commands/savings/forecast.ts` — mirror `history.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  PRO_ANALYTICS_UPSELL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./shared.js";

export type ForecastPeriodArg = "month" | "week";

export type ParsedGoal = { kind: "tokens" | "dollars"; amount: number };

// Boundary parse (§8): the renderer divides by the goal, so reject a non-finite
// or non-positive amount here rather than emit NaN%. `$`-prefixed → dollars.
export function parseGoal(raw: string): ParsedGoal | null {
  const isDollars = raw.startsWith("$");
  const amount = Number(isDollars ? raw.slice(1) : raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { kind: isDollars ? "dollars" : "tokens", amount };
}

export type RunSavingsForecastInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  period?: ForecastPeriodArg;
  goal?: string;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSavingsForecast(input: RunSavingsForecastInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(PRO_ANALYTICS_UPSELL);
    return 0;
  }

  let goal: ParsedGoal | null = null;
  if (input.goal !== undefined) {
    goal = parseGoal(input.goal);
    if (goal === null) {
      input.stderr(`Invalid --goal ${input.goal}: expected a positive number of tokens or $dollars.`);
      return 1;
    }
  }

  const { forecastSavings, budgetPace } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const period: ForecastPeriodArg = input.period ?? "month";
  const forecast = forecastSavings(events, { now: input.now(), period });
  const pace = goal ? budgetPace(forecast, goal) : null;

  if (input.json) {
    input.stdout(JSON.stringify(pace ? { forecast, pace } : { forecast }));
    return 0;
  }

  if (forecast.savedSoFar.bytes === 0) {
    input.stdout(`No savings recorded this ${period} yet.`);
    return 0;
  }

  const proj = formatDollarsSaved(forecast.projectedEnd.dollars);
  const saved = formatDollarsSaved(forecast.savedSoFar.dollars);
  const daysLeft = Math.round(forecast.daysLeft);
  let headline = `On pace to save ~${proj} this ${period} (est.) · ${saved} saved so far · ${daysLeft} days left`;
  if (pace) {
    const goalStr = goal?.kind === "dollars" ? formatDollarsSaved(goal.amount) : `${goal?.amount} tokens`;
    const pct = Math.round(pace.pctOfGoalProjected * 100);
    headline += ` — ${pct}% of your ${goalStr} goal (${pace.onTrack ? "on track" : "behind"})`;
  }
  input.stdout(headline);
  input.stdout("");
  input.stdout(`saved so far   ${saved} (${forecast.savedSoFar.tokens} tokens)`);
  input.stdout(`daily rate     ${formatDollarsSaved(forecast.dailyRate.dollars)} / day`);
  input.stdout(`projected end  ${proj} (${Math.round(forecast.projectedEnd.tokens)} tokens)`);
  return 0;
}

export const savingsForecastCommand = defineCommand({
  meta: { name: "forecast", description: "Project this period's savings + pace vs a goal (Mega Saver Pro)." },
  args: {
    goal: { type: "string", description: "Savings goal: <tokens> or $<dollars> (e.g. 5000000 or $15)." },
    period: { type: "string", description: "month | week (default: month)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const period = typeof args.period === "string" ? args.period : undefined;
    const code = await runSavingsForecast({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      ...(period === "month" || period === "week" ? { period } : {}),
      ...(typeof args.goal === "string" ? { goal: args.goal } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Then register it in `apps/cli/src/commands/savings/index.ts` — add `savingsForecastCommand` to the imports, the re-exports (`type RunSavingsForecastInput`, `runSavingsForecast`, `savingsForecastCommand`), and the group's `subCommands` (`forecast: savingsForecastCommand`). Check the file first to match the exact shape.

- [ ] **Step 4: Run → PASS.** `pnpm --filter @megasaver/cli test savings`.

- [ ] **Step 5: Commit** `feat(cli): mega savings forecast (Pro-gated)`.

### Task B2: README + changeset

**Files:**
- Modify: `README.md`
- Create: `.changeset/pro-forecast.md`

- [ ] **Step 1:** In `README.md`, under the existing Pro section (where history/insights are documented), add:

```
- `mega savings forecast [--goal $15]` — projects this period's savings by
  run-rate (labeled an estimate) and paces it against an optional goal.
```

- [ ] **Step 2:** Create `.changeset/pro-forecast.md`:

```md
---
"@megasaver/cli": minor
---

Add `mega savings forecast` — a Pro-gated run-rate savings projection with an
optional `--goal` pace, on the existing offline license.
```

- [ ] **Step 3: Commit** `docs(cli): document mega savings forecast + changeset`.

**Slice B boundary:** `pnpm verify` green (repo root).

---

## Final gate
- `pnpm verify` green (biome + tsc project refs + vitest).
- **Verifier reproduction:** with a test keypair — issue a key → `mega license activate` → `mega savings forecast` prints a projection labeled "(est.)"; `--goal $20` shows a pace %; `--json` shape `{forecast[,pace]}`; `--goal abc` → error exit 1; **no license → upsell (exit 0), nothing computed**. Capture output.
- Changeset added.
- code-reviewer + critic. Focus: the upsell path never imports/half-runs pro-analytics; run-rate math is correct + division-guarded (elapsedMs<=0, empty events, goal amount<=0 — no NaN/Infinity); in-period filtering is inclusive of periodStart and excludes future/out-of-period events; `$` display matches modules 1/2; bad `--goal` rejected at the boundary.

## Deferred
Persistent `budget.json`; anomaly alerts; non-linear/trend forecasting; per-project forecast; metering-proxy real-spend budget; Stripe; a fourth module.
