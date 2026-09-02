---
feature: tier1-platform-hardening
risk: HIGH
date: 2026-09-01
spec: docs/superpowers/specs/2026-09-01-tier1-platform-hardening-design.md
status: approved
reviewers: [code-reviewer, critic, security-reviewer]
---

# Tier 1 Platform Hardening — stop the dashboard and daemon from lying

## Context

The GUI Token Saver page and daemon lifecycle are scaffold stubs that passed CI on shape-only assertions.
Four pillars must become real: persisted budget, real $/ROI metering, real cache metering, and a supervised daemon.
User directive: loop until Tier 1 is functional + unit + integration + security green. pnpm verify is hard gate.

## Pillar 1 — Budget Persistence (the reset-on-restart bug)

### Current
`apps/gui/bridge/routes/analytics.ts` holds `let storedBudget` in memory (seed 5M/1.25M). Restart zeroes changes.
`packages/stats/src/budget.ts` already has `readBudget/writeBudget/clearBudget/budgetPath` with `atomicWriteFile` (0600/0700, fsync, no symlink) + Zod strict schema — unused by the route.

### Design
Route handlers become thin adapters over `packages/stats/src/budget.ts` backed by `ctx.storeRoot`:
- `GET /api/savings/budget` → `readBudget(storeRoot)` + `readAllWorkspaceTokenSaverTotals` for `spentTokens` (real spend, not hardcoded 1.25M).
- `POST /api/savings/budget` → Zod validate `{ monthlyBudgetTokens: number }`, `writeBudget` via `atomicWriteFile`, return derived `pacePercent/isOverBudget`.
- `DELETE /api/savings/budget` → `clearBudget`.
- Corrupt file → 200 `{ status: "corrupt" }` (never 500), absent → defaults.

### Interfaces
```ts
// routes/analytics.ts re-exports budget handlers; no new route paths.
// Uses: readBudget, writeBudget, clearBudget, budgetStatus from @megasaver/stats
//       readAllWorkspaceTokenSaverTotals + tokensFromBytes for spentTokens
```

### Testing
- pnpm verify; new bridge tests: POST then GET round-trips, persists across handler recreation (simulated restart), corrupt file degrades.

## Pillar 2 — Real Token Metering (ROI hardcodes)

### Current
`handleGetRoi` returns `142.5/18.2/9.5/1710` literals. `handleGetCacheStatus` returns `0.94/750k/45k`. `handleGetBenchReport` 88.4%. `handleGetAlerts` empty arrays. None read the store.

### Design
- ROI: `readAllWorkspaceTokenSaverTotals` + `computeSavingsHeadline` + `SAVINGS_FOOTNOTE` (single price source `MODEL_LIST_PRICES` @ $3/M 2026-08-01, `isEstimate:true`). `estimatedTimeSavedHours = tokensSaved / TOKENS_PER_HOUR` (constant from stats), ROI = `dollarsSaved / (tokens/price baseline)` — same formula CLI uses.
- Cache status: `readProxyUsage(storeRoot)` (tolerant reader, skippedLines surfaced) + `analyzeCacheChurn` where applicable; `handlePostCacheClear` becomes a real `clearCacheChurn` marker or is removed if no real backing op (decision: keep endpoint, clear churn marker file, return 200).
- Alerts/Bench: remain empty until real detectors exist — return honest `{ hasData: false }` instead of fabricating 88.4%.

### Interfaces
```ts
// analytics.ts: handleGetRoi, handleGetBudget family, handleGetBenchReport
// cache.ts: handleGetCacheStatus, handlePostCacheClear, handleGetCacheChurn
// All lazy-import heavy stats where needed, Zod at boundaries.
```

### Testing
- Bridge tests assert values change when store fixture changes (not just shape).
- savings-headline + model-prices pinned tests must stay green.

## Pillar 3 — Cross-Harness Unified Search

### Current
Hybrid search is the remaining tier-1 surface not covered by the 39-harness catalog wiring. Must extend the shared dispatcher, not fork per-harness routes (Harness-agnostic bridge rule).

### Design
- Extend `apps/gui/bridge/claude-sessions/harness-transcript.ts` dispatcher to expose unified search across harnesses.
- Hybrid = BM25 (existing keyword) + semantic sidecar (existing embeddings) with a single scoring function; results are harness-agnostic.
- No per-harness `if (harness === 'claude')` branch in any route — the dispatcher carries the extension.

### Interfaces
```ts
// harness-transcript.ts: add search export used by bridge route
// bridge route: GET /api/search?query=... → delegated to dispatcher
```

### Testing
- Dispatcher unit tests: cross-harness results, ranking stability.
- Bridge search route tests.

## Pillar 4 — Context Budget Enforcer + Daemon Supervisor

### Current
`apps/gui/bridge/routes/daemon.ts` + `packages/daemon/src/{server,spawn,discovery}` + `packages/proxy-control/src/{supervisor,reconcile}.ts` exist but GUI lifecycle never drives them. Frontend polls 2s and always shows "Daemon stopped" (screenshots). Budget enforcer has no persist.

### Design
- Daemon: wire `superviseDrive` / `monitorTick` (proxy-control) or daemon's own supervisor into the bridge lifecycle. Bridge exposes `GET /api/daemon` (status), `POST /api/daemon/start|stop` backed by `getRunningDaemon/spawnDaemon`. Frontend `fetchDaemonStatus` poll reflects real state. LOOPBACK-only + Bearer token wall preserved.
- Budget: `stats/budget.json` is the single source (Pillar 1) — enforcer reads it; no second store.

### Interfaces
```ts
// daemon.ts: handleDaemonStatus, handleDaemonStart, handleDaemonStop
// Uses: @megasaver/daemon getRunningDaemon/spawnDaemon, @megasaver/proxy-control superviseDrive when proxy is involved
```

### Testing
- Daemon route tests: start→status→stop transitions.
- Integration: monitor tick does not corrupt control state (regression from supervisor tests).

## Cross-Cutting

- **Security:** `isSafeSegment`/`workspaceKey` 16hex checks, 0o600/0o700, no-symlink, fsync, LOOPBACK CORS, `?token` stripped after auth.
- **Pricing invariant:** single source `MODEL_LIST_PRICES`, `SAVINGS_FOOTNOTE` rendered wherever $ shown, `isEstimate:true`.
- **Conventions:** no agent-specific logic in @megasaver/core, no new `@megasaver/*` edges beyond existing stats/daemon/proxy-control.

## Deliverables
- Real `docs/superpowers/specs/2026-09-01-tier1-platform-hardening-design.md` (this file)
- `docs/superpowers/plans/2026-09-01-tier1-platform-hardening-plan.md`
- Bridge route fixes + frontend wiring + tests
- `pnpm verify` green + `conventions:check` + security pass

## Risks
- Entitlement/license integrity is not touched — if needed, reclassify CRITICAL.
- Bench report 88.4% is not fabricated — absent data returns honest empty state.
