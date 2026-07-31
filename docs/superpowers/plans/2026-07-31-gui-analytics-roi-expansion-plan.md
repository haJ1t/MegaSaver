# GUI Analytics, Budget & ROI Expansion — Implementation Plan (Phase 3)

- **Spec:** `docs/superpowers/specs/2026-07-31-gui-analytics-roi-expansion-design.md`
- **Goal:** Implement bridge routes and UI components for Analytics, Budget, Alerts, and ROI in `@megasaver/gui`.

---

## Task 1: Bridge Endpoints
- [ ] Create `apps/gui/bridge/routes/analytics.ts` handling `/api/roi`, `/api/savings/budget`, `/api/alerts`, `/api/bench/report`.
- [ ] Register routes in `apps/gui/bridge/handler.ts`.
- [ ] Write Vitest test suite `apps/gui/test/bridge/analytics-route.test.ts`.

## Task 2: Frontend Components
- [ ] Build `RoiAnalyticsCard.tsx` and `TokenBudgetCard.tsx`.
- [ ] Add client API functions to `apps/gui/src/lib/claude-sessions-client.ts`.
- [ ] Embed components in `OverviewPage` or `TokenSaverPage`.

## Task 3: Verification
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @megasaver/gui test`
