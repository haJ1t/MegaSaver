---
title: Pro module — anomaly alerts + persistent budgets (mega alerts, mega savings budget)
date: 2026-07-09
status: approved
risk: MEDIUM
scope: a new pure pro-analytics detector module (robust daily-spike detection over savings + firewall streams, budget-pace check) + a persistent stats/budget.json store + a gated standalone `mega alerts` command + gated `mega savings budget set|show|clear` + forecast auto-loading the stored budget. No entitlement/crypto change; no change to existing schemas or to forecast.ts pure functions.
base: main (5e1a0243)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved 2026-07-09 — 4 scope answers + approach A + 5 design sections)
---

# Pro module — anomaly alerts + persistent budgets (1.13 / N7)

## Motivation

m3 (`savings forecast`, 2026-07-06) deferred two extensions by name: a
persistent `budget.json` store and anomaly/spike alerting (source: forecast
spec Non-goals). This module ships both: the stored budget makes the forecast
a standing dashboard (no flag re-typing), and the alerts command answers
**"did anything unusual happen?"** — traffic spikes, a ballooning source, a
compression-effectiveness collapse, or a redaction surge from the 1.12
firewall ledger. Deterministic statistics, no LLM, on-demand only.

## Locked decisions (user-approved 2026-07-09)

1. **Budget = persistent savings goal** — m3's `--goal` flag moved to disk
   (`period` + `kind` + `amount`). The metering-proxy real-spend budget stays
   out of scope (it was a separate m3 non-goal). A context-traffic cap is a
   non-goal.
2. **Anomaly axes: all four** — daily traffic spike, per-source/label spike,
   saving-ratio drop, firewall-event spike. Plus a budget-pace check when a
   stored budget exists.
3. **Channel: on-demand CLI only** — `mega alerts` + a behind-budget line in
   forecast. No hook nudge, no GUI panel, no daemon (this cut).
4. **All Pro** — every new command gated on the existing `"savings-analytics"`
   key. No entitlement/crypto change.
5. **Approach A** — pure detector in `pro-analytics`, budget store in
   `@megasaver/stats`, standalone `mega alerts` (spans savings + firewall
   streams), `mega savings budget` under the savings group, forecast auto-load
   at the CLI layer only.

## Design

### 1. Pure detector — `packages/pro-analytics/src/alerts.ts`

No I/O. Composes existing pure functions (`forecastSavings`, `budgetPace`,
`tokensFromBytes`); reuses the `FirewallEventInput` structural type from
`firewall-report.ts` (no context-gate dependency).

```
export type AlertAxis = "traffic" | "source" | "ratio" | "firewall" | "budget";

export type AnomalyFinding = {
  axis: AlertAxis;
  key: string | null;        // label for "source"; null elsewhere
  todayValue: number;        // tokens (traffic/source), ratio 0..1 (ratio),
                             // Σcount (firewall), projected unit (budget)
  baselineMedian: number;    // 0 for budget axis
  threshold: number;         // the trigger value that was crossed
  message: string;           // one human-readable line
};

export type AlertsReport = {
  windowDays: number;
  today: string;                       // UTC day bucket YYYY-MM-DD
  historyDays: { events: number; firewall: number };
  status: "ok" | "alerts" | "insufficient-history";
  findings: AnomalyFinding[];          // triggered only
  insufficientAxes: AlertAxis[];       // skipped for lack of history
  advice: string[];                    // fixed ALERT_ADVICE strings, one per triggered axis
};

export function detectAnomalies(
  events: readonly TokenSaverEvent[],
  firewallEvents: readonly FirewallEventInput[],
  budget: { period: ForecastPeriod; goal: BudgetGoal } | null,
  opts: { now: number; windowDays: number },
): AlertsReport;
```

**Bucketing.** UTC day = `createdAt.slice(0, 10)` (the `history.ts` idiom;
`Date.parse` NaN rows skipped). "Today" = the UTC day of `opts.now`. Baseline
series = the trailing `windowDays` calendar days **ending yesterday** (today
never contributes to its own baseline). Calendar days with no events count
as 0.

**Threshold (upper-tail axes: traffic, source, firewall).** Robust statistics
over the baseline series: `median + ALERT_K_MAD × MAD` where
`MAD = median(|xᵢ − median|)`. When `MAD === 0` (flat baselines, all-zero
histories) fall back to `max(ALERT_FALLBACK_MULTIPLE × median, floor)`.
A finding requires BOTH `todayValue > threshold` AND `todayValue ≥ floor`
(the per-axis absolute floor kills first-day-of-use noise over an all-zero
baseline and tiny-median jitter).

**Ratio axis (lower tail).** Daily ratio = `Σ bytesSaved / Σ rawBytes` for the
day (0-guarded). Threshold = `median − max(ALERT_K_MAD × MAD,
ALERT_RATIO_MIN_DROP)`. A finding requires `todayRatio < threshold` AND
`todayRawBytes ≥ ALERT_RATIO_FLOOR_BYTES` (the ratio is meaningless on thin
traffic).

**History guards (per axis family).** Event-based axes (traffic, source,
ratio) need `today − firstEventDay ≥ ALERT_MIN_HISTORY_DAYS`; the firewall
axis needs the same against its own stream (the 1.12 ledger may be younger).
An axis lacking history goes to `insufficientAxes`, produces no finding.
`historyDays` reports both counts (capped at `windowDays`).

**Axes.**

- `traffic` — tokens/day store-wide: `tokensFromBytes(Σ rawBytes)`.
  Floor `ALERT_TRAFFIC_FLOOR_TOKENS`.
- `source` — per label (the `insights.ts` `by:"label"` key): each label active
  today is tested against its own trailing daily series (zeros included).
  Floor `ALERT_SOURCE_FLOOR_TOKENS`. One finding per triggered label,
  `key = label`.
- `ratio` — as above; `key = null`.
- `firewall` — Σ`count`/day over `FirewallEventInput` rows (counts only —
  the F-FW-1 value-free invariant is untouched; the detector never sees or
  emits a matched value). Floor `ALERT_FIREWALL_FLOOR_EVENTS`.
- `budget` — only when `budget != null`: `forecastSavings(events, { now,
  period })` → `budgetPace(forecast, goal)`; `onTrack === false` → finding
  with `todayValue = projectedUnit`, `threshold = goal.amount`, message
  `behind budget: projected <X> of <Y> (<pct>%)`. No history requirement;
  `budget == null` skips the axis silently (absent by configuration, not
  insufficient).

**Report status.** `alerts` when `findings.length > 0`; else
`insufficient-history` when every applicable axis lacked history; else `ok`.

**Spec-locked constants (exported, `fix.ts` style).**

```
ALERT_WINDOW_DAYS_DEFAULT   = 30
ALERT_MIN_HISTORY_DAYS      = 7
ALERT_K_MAD                 = 3.5
ALERT_FALLBACK_MULTIPLE     = 4
ALERT_TRAFFIC_FLOOR_TOKENS  = 50_000
ALERT_SOURCE_FLOOR_TOKENS   = 25_000
ALERT_FIREWALL_FLOOR_EVENTS = 5
ALERT_RATIO_MIN_DROP        = 0.15
ALERT_RATIO_FLOOR_BYTES     = 262_144   // 256 KiB raw/day
ALERT_ADVICE                = { traffic, source, ratio, firewall, budget }  // fixed strings
```

All exports re-exported from `src/index.ts`.

### 2. Budget store — `packages/stats/src/budget.ts`

`<store>/stats/budget.json`, store-wide (m3's forecast is store-wide; a
per-project budget is a non-goal).

```
budgetSchema = z.object({
  version: z.literal(1),
  period:  z.enum(["month", "week"]),
  kind:    z.enum(["tokens", "dollars"]),
  amount:  z.number().finite().positive(),
}).strict();
export type StoredBudget = z.infer<typeof budgetSchema>;

budgetPath(root)              // join(root, "stats", "budget.json")
readBudget(root): StoredBudget | null      // absent OR corrupt → null
budgetStatus(root): "absent" | "ok" | "corrupt"   // license.json-style distinction
writeBudget(root, budget)     // existing atomicWriteFile (temp+fsync+rename, symlink-parent guard)
clearBudget(root)             // rm; idempotent (missing file is success)
```

Reads `safeParse`; no legacy shapes (new file, version 1). Exported from
`packages/stats/src/index.ts` and re-exported through `@megasaver/core` like
`readEvents` (CLI never imports stats directly — `shared.ts:17-19` rule).

### 3. CLI

**Gate pattern (all three surfaces).** `checkEntitlement("savings-analytics",
{ storeRoot, now, publicKey? })` FIRST; not entitled → upsell to stdout,
`return 0`, nothing read or imported (spy-enforced, as in cache/firewall).
`mega alerts` gets its own `ALERTS_UPSELL`; the budget subcommands reuse
`PRO_ANALYTICS_UPSELL` (savings family).

**`mega savings budget`** — new subcommand group under `savings`
(`apps/cli/src/commands/savings/index.ts`):

- `set <value>` — `$`-prefixed → dollars, else tokens (exact `parseGoal`
  semantics from forecast.ts); `--period month|week` (default `month`).
  Invalid amount (non-finite or ≤ 0) → stderr + exit 1. Writes
  `{ version: 1, ... }`; overwriting an existing (even corrupt) file is the
  repair path.
- `show` — prints period/kind/amount; `absent` → honest "No budget set." exit
  0; `corrupt` → stderr pointing at the path + "run `mega savings budget
  clear`" + exit 1.
- `clear` — removes; idempotent; exit 0.
- All support `--json` and `--store`.

**`mega alerts`** — standalone top-level command (cache/firewall precedent),
registered in `main.ts`. Entitled path: lazy `await
import("@megasaver/pro-analytics")` → `defaultSavingsEventReader` + firewall
ledger read (the `firewall.ts:38` pattern) + `readBudget` → `detectAnomalies`
→ render:

- default: status headline, then one line per finding (axis, key, today vs
  baseline median, threshold), then advice footer; `insufficient-history` →
  honest "Not enough history yet (N days; needs 7)." line; no findings →
  "No anomalies in the last N days."
- `--json`: stable `AlertsReport` contract.
- Flags: `--days <1..3650>` (default 30, the local `parseDays` shape from
  cache.ts/firewall.ts — 3 similar lines > premature abstraction), `--json`,
  `--store`. Always exit 0 on a successful scan (informational), including
  when findings exist.
- Corrupt `budget.json` → skip the budget axis + one stderr note, exit 0.

**Forecast auto-load** (`apps/cli/src/commands/savings/forecast.ts`, CLI layer
only — the pure functions are untouched): explicit flags always win; the
stored budget fills gaps. No `--goal` → stored `kind`/`amount` becomes the
goal; no explicit `--period` → stored `period`. The pace segment gains a
`(stored budget)` marker when the goal came from disk. Corrupt file → stderr
note, behave as if absent, exit unchanged.

### 4. Docs + changeset + wiki

- `README.md` Pro section: `mega alerts` + `mega savings budget` bullets.
- `.changeset/anomaly-alerts-budgets.md`: `@megasaver/cli` minor
  (`pro-analytics`/`stats` private/internal → covered by the CLI release).
- Wiki: `entities/cli`, `syntheses/pro-differentiation-portfolio` status row,
  `log.md` entry. Release 1.13.0 via the standard tag→publish ritual.

## Security / risk (MEDIUM)

No crypto, no licensing logic change, no user-repo mutation, no new secrets.
`budget.json` is a single additive config file in the megasaver store (goal
numbers only — nothing sensitive), written with the existing hardened
`atomicWriteFile`; no existing schema changes. The firewall axis consumes
counts only — F-FW-1 (value-free ledger) is preserved end to end. The m3 spec
deferred the store as "higher risk"; assessed here as MEDIUM because the
store is additive, single-file, and store-internal — the reviewer may upgrade
(never silently downgrade, §12). Reviewers: **code-reviewer + critic** (the
trivial-fixture pattern — the critic must mutation-test the detector guards
with real synthetic series). Worktree; full superpowers chain.

## Testing (TDD)

- **Detector (pure):** per axis — clear spike triggers / quiet day doesn't;
  MAD=0 fallback (flat + all-zero baselines); floor suppresses first-day
  spike; today excluded from its own baseline; ratio lower-tail + volume
  floor; firewall Σcount (not line count) + independent history guard;
  budget behind/on-track/absent; `insufficient-history` under 7 days;
  empty-everything → ok with zero findings, never NaN/Infinity; determinism
  (fixed `now`); constants exported with spec-locked values.
- **Budget store:** roundtrip; absent → null/"absent"; corrupt JSON + wrong
  schema → null/"corrupt"; atomic write (no partial file on simulated
  failure); clear idempotent; symlink-parent guard inherited from
  `atomicWriteFile`.
- **CLI:** no license → upsell + zero reads/imports (spies) for all three
  surfaces; `budget set → show → clear` roundtrip on a real temp store; bad
  `set` values (`abc`, `0`, `-5`, `$0`); `alerts` on a synthetic store with a
  planted spike day → finding rendered + `--json` shape; `--days` bounds;
  forecast auto-load (stored used when flags absent, flags override, marker
  shown, corrupt → honest note).
- `pnpm verify` green. E2E smoke: test key → activate → `budget set $20` →
  `forecast` shows `(stored budget)` pace → `alerts` on planted-spike store
  prints the finding; no license → upsells.

## Non-goals (deferred)

Hook-nudge channel; GUI alert panel; daemon/background or scheduled
evaluation; notification integrations; real-spend/proxy budget; per-project
budgets; multiple budgets; trend/seasonality models (weekday effects);
severity tiers; auto-remediation (that's `savings fix`).

## Slices

- **A**: `@megasaver/stats` budget store (`budget.ts` + core re-export) — TDD.
- **B**: `pro-analytics` detector (`alerts.ts` + index re-exports) — TDD.
- **C**: CLI — `mega alerts`, `mega savings budget`, forecast auto-load,
  registration + README + changeset — TDD.
