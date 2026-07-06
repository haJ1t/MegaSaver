---
title: Pro module 3 — savings budget & forecast (mega savings forecast)
date: 2026-07-06
status: approved
risk: MEDIUM
scope: a third proprietary pro-analytics module (run-rate forecast + optional goal pace) + a gated `mega savings forecast` command. No entitlement/crypto change; no persistence (goal is a flag).
base: main (b69b7f3e)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved 2026-07-06; flag-based goal, persistent budget deferred)
---

# Pro module 3 — savings budget & forecast

## Motivation

The Pro tier's analytics answer "what happened" (module 1, `savings history` —
the time axis) and "where it leaks" (module 2, `savings insights` — the source
axis). This third module answers **"where are you heading"** — it projects the
current period's end-of-period savings from the run-rate, and (optionally) paces
that against a savings goal. It turns the rear-view report into a dashboard.

## Locked decisions (user-approved 2026-07-06)

1. Third module = **savings budget & forecast** (not anomaly alerts, not
   memory/decision-trace ROI).
2. **Flag-based goal** — `--goal <n>` (tokens) or `--goal $<n>` (dollars). A
   persistent `budget.json` store is **deferred** (a new storage schema is higher
   risk/§12 and unnecessary for the first cut). The forecast is fully useful with
   no goal; the goal only adds pace context.
3. **No entitlement/crypto change.** Reuses the existing `"savings-analytics"`
   feature key (tier-based; `checkEntitlement` ignores the feature arg). The
   security-critical `@megasaver/entitlement` package is untouched.
4. **Honesty:** the projection is a run-rate estimate, labeled **"(est.)"** in
   the output, consistent with the site's dollar-estimate discipline. It forecasts
   ONLY the savings Mega Saver actually measures — never a fabricated "total bill".

## Design

### 1. Proprietary pure functions — `packages/pro-analytics/src/forecast.ts`

`TokenSaverEvent` carries `createdAt` (ISO-8601 with offset) and `bytesSaved`.

- **`forecastSavings(events, { now, period }): SavingsForecast`**
  where `period: "month" | "week"`, `now: number` (ms epoch, injected for
  determinism). Computes the current period window, sums in-period savings, and
  projects end-of-period savings by run-rate.
  - **Period window (UTC):**
    - `month`: `periodStart = Date.UTC(y, m, 1)`; `periodEnd = Date.UTC(y, m+1, 1)`.
    - `week`: Monday-based. `dow = (new Date(now).getUTCDay() + 6) % 7` (0=Mon);
      `periodStart = startOfUTCDay(now) - dow*86_400_000`; `periodEnd = periodStart + 7*86_400_000`.
  - `inPeriod` = events whose `Date.parse(createdAt)` is in `[periodStart, now]`.
  - `savedBytes = Σ bytesSaved(inPeriod)`; `savedTokens = tokensFromBytes(savedBytes)`;
    `savedDollars = dollarsFromTokens(savedTokens)`.
  - `elapsedMs = now - periodStart`; `totalMs = periodEnd - periodStart`.
  - `dailyRateTokens = elapsedMs <= 0 ? 0 : savedTokens / (elapsedMs/86_400_000)`.
  - `projectedTokens = elapsedMs <= 0 ? savedTokens : savedTokens * (totalMs / elapsedMs)`
    (run-rate). `projectedDollars = dollarsFromTokens(projectedTokens)`.
  - Returns:
    ```
    SavingsForecast = {
      period: "month" | "week";
      periodStart: string;  // ISO
      periodEnd: string;    // ISO
      elapsedDays: number;  // elapsedMs/86_400_000
      totalDays: number;
      daysLeft: number;     // max(0, totalDays - elapsedDays)
      savedSoFar:  { bytes: number; tokens: number; dollars: number };
      dailyRate:   { tokens: number; dollars: number };
      projectedEnd:{ tokens: number; dollars: number };
    }
    ```
  - Empty events / `elapsedMs<=0` → zeros + projectedEnd == savedSoFar (can't
    project from no elapsed time; never NaN/Infinity).

- **`budgetPace(forecast, goal): BudgetPace`**
  where `goal = { kind: "tokens" | "dollars"; amount: number }`.
  - `unit = kind === "dollars" ? dollars fields : tokens fields`.
  - `pctOfGoalSoFar = amount <= 0 ? 0 : savedUnit / amount`.
  - `pctOfGoalProjected = amount <= 0 ? 0 : projectedUnit / amount`.
  - `onTrack = projectedUnit >= amount` (on pace to meet/beat the savings goal).
  - Returns `{ goal, savedUnit, projectedUnit, pctOfGoalSoFar, pctOfGoalProjected, onTrack }`.

Pricing model + helpers: reuse `tokensFromBytes` + `INPUT_PRICE_PER_MTOK_USD`
from `@megasaver/stats`; replicate the 3-line `dollarsFromTokens` locally (per §8,
"3 similar lines > premature abstraction"). Exported from `src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/savings/forecast.ts`

`runSavingsForecast(input)` mirrors `runSavingsHistory` exactly:

1. `checkEntitlement("savings-analytics", { storeRoot, now, publicKey? })` **first**.
2. Not entitled → `PRO_ANALYTICS_UPSELL`, `return 0`. No `pro-analytics` import, no
   events read (enforced by spies, as in history/insights).
3. Entitled → lazy `await import("@megasaver/pro-analytics")`, `readAllEvents`,
   `forecastSavings(events, { now, period })`, and if `--goal` parsed →
   `budgetPace(forecast, goal)`. Render:
   - default: a headline line —
     `On pace to save ~$<projected> this <period> (est.) · $<saved> saved so far · <daysLeft> days left`
     plus (when a goal is set) ` — <pct>% of your <goal> goal (on track / behind)`,
     then a small labeled breakdown (saved so far, daily rate, elapsed/total days,
     projected). `$` floored via `formatDollarsSaved` (from `@megasaver/core`).
   - `--json`: `JSON.stringify({ forecast, pace })` (`pace` omitted when no goal).
   - no in-period events → still valid: projects 0, prints an honest
     "No savings recorded this <period> yet." line, `return 0`.

Flags: `--goal <n|$n>`, `--period month|week` (default `month`), `--json`,
`--store <dir>`.

**`--goal` parsing (boundary, §8 parse-on-handoff):** a `$`-prefixed value →
`{ kind:"dollars", amount:Number(rest) }`; otherwise `{ kind:"tokens",
amount:Number(value) }`. If `--goal` is present but the amount is not a finite
number > 0 → print an honest error to stderr and `return 1` (the renderer would
divide by it). Absent `--goal` → no pace, forecast only.

Register `forecast` under the existing `savings` group
(`apps/cli/src/commands/savings/index.ts`, alongside history/export/insights).

### 3. Docs + changeset

- `README.md` Pro section: add a `mega savings forecast` bullet.
- `.changeset/pro-forecast.md`: `@megasaver/cli` minor. `pro-analytics` private →
  no changeset. `@megasaver/entitlement` unchanged.

## Security / risk (MEDIUM)

No crypto, no licensing logic, no persistence, no user-file mutation, no new
secrets. The entitlement seam is reused read-only. Events are already-validated
`TokenSaverEvent`s from Core's reader (no re-parse on the read side, §8); the only
re-parse is the `--goal` flag at the CLI boundary. Reviewers: **code-reviewer +
critic** (the "trivial-fixture masks reality" pattern has repeatedly bitten this
codebase — the critic runs real experiments and mutation-tests the guards).
Security-reviewer not required (no crypto/secrets/user-data surface).

## Testing (TDD)

- **forecast (pure)**:
  - month period: events across the month → correct `savedSoFar`; with `now`
    half-way through, `projectedEnd ≈ 2× savedSoFar` (run-rate); `daysLeft` correct.
  - week period: Monday-based window; only in-week events counted.
  - events outside the current period are excluded.
  - `elapsedMs<=0` (now === periodStart) → projectedEnd == savedSoFar, dailyRate 0,
    no NaN/Infinity.
  - empty events → all zeros, no NaN.
  - `budgetPace`: dollars goal + tokens goal; `pctOfGoalProjected` correct;
    `onTrack` true when projected ≥ goal, false when below; `amount<=0` → 0 (no NaN).
- **CLI forecast**:
  - no license → upsell, computes nothing, exit 0 (spies assert `forecastSavings`/
    `budgetPace` + `readAllEvents` NOT called).
  - valid license → headline with projected $ + saved-so-far; `--goal $10` shows
    pace %; `--json` shape `{ forecast, pace }`; bad `--goal` (`abc`, `0`, `-5`) →
    stderr error + exit 1.
  - no in-period events → "No savings recorded this month yet.", exit 0.
- `pnpm verify` green. E2E smoke: test key → activate → `mega savings forecast`
  prints a projection; `--goal $20` shows pace; no license → upsell.

## Non-goals (deferred)

Persistent `budget.json` / stored budgets; anomaly/spike alerting; trend
(non-linear) forecasting; per-project forecasts; the metering-proxy real-spend
budget; Stripe; a fourth module.

## Slices

- **A**: `pro-analytics` pure fns (`forecastSavings` + `budgetPace`) — TDD.
- **B**: gated `mega savings forecast` command + register + README + changeset — TDD.
