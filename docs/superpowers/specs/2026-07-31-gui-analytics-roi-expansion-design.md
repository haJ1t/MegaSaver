# GUI Analytics, Budget & ROI Expansion — Design Spec (Phase 3)

- **Date:** 2026-07-31
- **Status:** proposed
- **Risk:** MEDIUM (Bridge endpoints + Pro Analytics integration + React UI). Worktree, TDD, `code-reviewer` pass, `pnpm verify` DoD.
- **Goal:** Expose ROI calculations (`mega roi`), Token Spending Budgets (`mega savings budget`), Anomaly Alerts (`mega alerts`), and Benchmark reports (`mega bench`) in `@megasaver/gui`.

---

## 1. Problem

MegaSaver Pro provides ROI metrics, token budget limits, anomaly alerts, and benchmark reports via CLI, but users have no visual dashboard in `@megasaver/gui` to monitor financial savings, budget pacing, or traffic anomalies.

---

## 2. Architecture & Bridge Routes

### 2.1 New Bridge Routes (`apps/gui/bridge/routes/analytics.ts`)

1. **`GET /api/roi`**
   - Returns `{ savedDollars: number, timeSavedHours: number, roiRatio: number, projectedAnnualSavings: number }`.
2. **`GET /api/savings/budget` & `POST /api/savings/budget` & `DELETE /api/savings/budget`**
   - Manages token budget limit (`monthlyBudgetTokens`, `spentTokens`, `pacePercent`, `isOverBudget`).
3. **`GET /api/alerts`**
   - Returns active anomaly alerts (`spikes[]`, `firewallSpikes[]`).
4. **`GET /api/bench/report`**
   - Returns benchmark savings and latency comparison report.

---

## 3. UI Components (`apps/gui/src/components/`)

1. **`RoiAnalyticsCard`**: Displays ROI metrics, saved dollars, and time saved.
2. **`TokenBudgetCard`**: Displays spending budget gauge and allows setting/clearing monthly token limits.
3. **`AnomalyAlertsCard`**: Displays active anomaly spikes and firewall alerts.

---

## 4. Testing & Verification

- Vitest unit tests in `apps/gui/test/bridge/analytics-route.test.ts`.
- React tests in `apps/gui/test/components/roi-analytics-card.test.tsx`.
- `pnpm typecheck` and `pnpm --filter @megasaver/gui test`.
