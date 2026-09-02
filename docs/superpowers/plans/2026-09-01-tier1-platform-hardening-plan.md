# Tier 1 Platform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every stub that lies on the GUI (hardcoded ROI/cache/bench/alerts, in-memory budget, no-op cache clear, never-supervised daemon) with store-backed, tested, security-clean reads, plus a cross-harness unified search dispatcher.

**Architecture:** Bridge routes become thin adapters over existing single-source-of-truth packages (`@megasaver/stats` for metering+budget, `packages/llm-proxy/store.ts` for cache, `@megasaver/daemon` + `proxy-control` for daemon). No new `@megasaver/*` dependency edges beyond those three. Pricing invariant (`MODEL_LIST_PRICES` 2026-08-01) never duplicated. Harness search extends the shared dispatcher per Harness-agnostic rule.

**Tech Stack:** TypeScript strict ESM, pnpm workspaces, Vitest, tsup/Turbo, Biome, Zod, Node fs with atomicWriteFile (0600/0700/fsync/no-symlink).

**Spec:** `docs/superpowers/specs/2026-09-01-tier1-platform-hardening-design.md`

## Global Constraints
- Node 22 LTS, TypeScript strict ESM, pnpm workspace-protocol, tsup+Turborepo, Vitest, Biome, Changesets.
- No agent-specific logic in @megasaver/core.
- Zod at every external boundary; lazy import heavy deps.
- 0o600 files / 0o700 dirs, fsync, refuse symlinks, LOOPBACK-only daemon, Bearer token wall, isSafeSegment checks.
- Single price source MODEL_LIST_PRICES, SAVINGS_FOOTNOTE with capturedAt, isEstimate:true.
- pnpm verify (biome+tsc+vitest+conventions:check) must stay green; Author!=Reviewer.

---

### Task 1: Budget Persistence — kill the in-memory stub

**Files:**
- Modify: `apps/gui/bridge/routes/analytics.ts`
- Modify: `apps/gui/bridge/handler.ts` (only if wiring changes)
- Test: `apps/gui/test/bridge/analytics-route.test.ts` (extend) + `apps/gui/test/bridge/budget-route.test.ts` (new if needed)

**Interfaces:**
- Consumes: `readBudget/writeBudget/clearBudget/budgetStatus` from `@megasaver/stats`, `readAllWorkspaceTokenSaverTotals` + `tokensFromBytes`
- Produces: `handleGetBudget/handlePostBudget/handleDeleteBudget` now persist via `atomicWriteFile` keyed by `ctx.storeRoot`

- [ ] **Step 1: Write failing test — budget round-trip + restart persistence**
```ts
// apps/gui/test/bridge/analytics-route.test.ts (or new budget-route.test.ts)
// POST /api/savings/budget { monthlyBudgetTokens: 3000000 } → 200; GET → same value.
// Re-create handler with same tmp storeRoot → GET still returns 3000000 (not 5M default).
// Corrupt budget file (write invalid JSON) → GET returns { status: "corrupt" } not 500.
```
- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/analytics-route.test.ts`
Expected: FAIL (restart loses value or corrupt throws 500)
- [ ] **Step 3: Implement persistent handlers in analytics.ts**
Replace `let storedBudget` with calls to `readBudget/writeBudget/clearBudget` against `ctx.storeRoot`. Validate POST body via Zod strict schema. Derive `spentTokens = tokensFromBytes(totals.deltaBytesTotal)` from `readAllWorkspaceTokenSaverTotals` when computing pace/isOverBudget.
- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/analytics-route.test.ts`
Expected: PASS
- [ ] **Step 5: Typecheck**
Run: `pnpm --filter @megasaver/gui exec tsc --noEmit`

---

### Task 2: Real Token Metering — ROI + Cache + Bench/Alerts honesty

**Files:**
- Modify: `apps/gui/bridge/routes/analytics.ts` (handleGetRoi, handleGetBenchReport, handleGetAlerts)
- Modify: `apps/gui/bridge/routes/cache.ts` (handleGetCacheStatus, handlePostCacheClear, handleGetCacheChurn)
- Modify: `apps/gui/src/components/roi-analytics-card.tsx` (only if response shape grows footnote/hasData)
- Modify: `apps/gui/src/components/cache-doctor-card.tsx` (auto-refresh after clear, no refresh=still 0.94 bug)
- Test: `apps/gui/test/bridge/analytics-route.test.ts`, `apps/gui/test/bridge/cache-churn-route.test.ts`

**Interfaces:**
- Consumes: `readAllWorkspaceTokenSaverTotals`, `computeSavingsHeadline`, `SAVINGS_FOOTNOTE`, `MODEL_LIST_PRICES` (stats); `readProxyUsage` (llm-proxy, tolerant + skippedLines)
- Produces: `handleGetRoi` returns real dollars from store; `handleGetCacheStatus` returns real hit ratio from usage log; empty bench/alerts return `{ hasData:false }` honestly

- [ ] **Step 1: Write failing test — ROI reflects fixture**
```ts
// Seed stats fixture into tmp store, GET /api/roi, assert savedDollars !== 142.5 and equals computeSavingsHeadline(readAllWorkspace...).dollarsSaved
// GET /api/cache/status with 2 proxy usages → cacheReadInputTokens matches seed, not 750k
// Cache clear → status then differs or skippedLines accounted for
```
- [ ] **Step 2: Run test to verify it fails**
Expected: FAIL (still 142.5 / 750k)
- [ ] **Step 3: Wire real reads**
`handleGetRoi`: read totals, compute headline, derive timeSaved/roiAnnual similarly to CLI. `handleGetCacheStatus`: `readProxyUsage` + `analyzeCacheChurn` real wiring; `handlePostCacheClear` performs a real marker or honest no-op with status. Bench/alerts honest empty.
- [ ] **Step 4: Wire frontend cache-clear auto-refresh (already half-done: onClear re-fetches) — verify it actually changes after real backend clear**
- [ ] **Step 5: Run tests green**
Run: `pnpm --filter @megasaver/gui exec vitest run` + `pnpm --filter @megasaver/stats exec vitest run`

---

### Task 3: Cross-Harness Unified Search (hybrid, harness-agnostic)

**Files:**
- Modify: `apps/gui/bridge/claude-sessions/harness-transcript.ts` (extend shared dispatcher)
- Modify: `apps/gui/bridge/handler.ts` + new `apps/gui/bridge/routes/search.ts` (if not already present)
- Test: `apps/gui/test/bridge/search-route.test.ts` + dispatcher unit test

**Interfaces:**
- Consumes: existing BM25 + semantic sidecar APIs
- Produces: `GET /api/search?query=...` → `{ results: HarnessAgnosticHit[] }` scored by hybrid function; no per-harness if-branches in the route

- [ ] **Step 1: Write failing test — search is harness-agnostic**
- [ ] **Step 2: Run to fail**
- [ ] **Step 3: Implement dispatcher extension + route**
- [ ] **Step 4: Run to pass**

---

### Task 4: Daemon Supervisor & Budget Enforcer wiring

**Files:**
- Modify: `apps/gui/bridge/routes/daemon.ts`
- Modify: `apps/gui/src/lib/claude-sessions-client.ts` (fetchDaemonStatus helpers already exist — verify polling)
- Modify: `apps/gui/src/components/daemon-status.tsx` or equivalent consumer
- Test: `apps/gui/test/bridge/daemon-route.test.ts`

**Interfaces:**
- Consumes: `getRunningDaemon/spawnDaemon` (@megasaver/daemon), `superviseDrive/monitorTick` (proxy-control when proxy is the supervised resource)
- Produces: `GET /api/daemon` reflects real pid/liveness; `POST /api/daemon/*` drives transitions; frontend poll shows live state

- [ ] **Step 1: Write failing test — start→status→stop transitions**
- [ ] **Step 2: Implement lifecycle wiring; preserve LOOPBACK + token wall**
- [ ] **Step 3: Verify frontend poll no longer stuck on Daemon stopped when daemon is running**
- [ ] **Step 4: Budget enforcer reads the same budget.json (Task 1) — no second store**

---

### Task 5: Verification — full gates

**Files:**
- Verify: `pnpm verify` (biome + tsc --noEmit + vitest + conventions:check) entire repo green
- Security: 0600/0700/fsync/symlink refusal, isSafeSegment, CORS/Bearer, traversal tests
- Update: `wiki/log.md` + `wiki/agent-channel.md`

- [ ] **Step 1: pnpm verify full**
- [ ] **Step 2: Security pass — traversal, symlink, permission checks**
- [ ] **Step 3: Functional — restart persists budget, cache clear refetches, ROI changes with fixture, daemon status real**
- [ ] **Step 4: Wiki + PR**
Run: `gh pr create` → squash when green, `finishing-a-development-branch`
