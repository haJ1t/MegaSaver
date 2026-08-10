# GUI Pro Analytics Live-Wire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace six hardcoded-constant GUI bridge routes
(`/api/roi`, `/api/savings/budget`, `/api/alerts`, `/api/bench/report`,
`/api/cache/status`, `/api/forge/failures`+`/api/forge/learn`,
`/api/firewall/status`) with real reads through
`@megasaver/pro-analytics` / `@megasaver/core`, gated by
`checkEntitlement` exactly like their CLI counterparts (spec:
`docs/superpowers/specs/2026-08-08-gui-pro-analytics-live-wire-design.md`).

**Architecture:** Each route gets a rewrite that (a) calls
`checkEntitlement("savings-analytics", …)` first for the four gated
routes, (b) lazy-imports `@megasaver/pro-analytics` only on the
entitled path, (c) reads real store data via the same functions the
CLI already uses. A new shared reader `readGuiSavingsEvents` avoids
duplicating the CLI's project/session enumeration loop. One CLI-side
addition (`mega bench --store-report`) persists a bench report the
GUI can read; this is the only production code touched outside
`apps/gui`.

**Tech Stack:** TypeScript strict ESM, Zod at boundaries, Vitest,
existing `RouteContext`/`sendJson` bridge conventions, no new runtime
dependencies beyond two existing monorepo packages
(`@megasaver/entitlement`, `@megasaver/pro-analytics`) added to
`apps/gui/package.json`.

## Global Constraints

- Every gated route calls `checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now })` BEFORE any `@megasaver/pro-analytics` import — the free path must reach the locked response without ever loading Pro compute (spec Decision 1, Decision 3).
- Not-entitled response is `200 { locked: true, upsellUrl: "https://megasaver.dev/pro" }` — never a 403, never a fabricated number (spec Decision 1).
- `POST /api/cache/clear` is DELETED, not reimplemented — remove its handler, its route-table entry, its client function, and its "Clear" button (spec Decision 4).
- Zero changes to any existing CLI command's stdout/exit-code contract, EXCEPT the additive `mega bench --store-report` flag (spec Decision 6) — omitting the flag must leave `bench.ts` behavior byte-identical to today.
- `apps/gui`'s new `@megasaver/entitlement` + `@megasaver/pro-analytics` dependency edges are the ONLY new edges this plan adds; Task 6 pins them in a new dependency-graph guard test.
- Firewall (`/api/firewall/status`) and FORGE (`/api/forge/*`) routes stay UNGATED — they mirror free CLI commands (`mega firewall`, `mega fail list`, `mega learn from-failure`) (spec Decision 7).
- Every rewritten handler keeps the existing `handleCaughtError` outer wrapper — no route in this plan returns a raw stack trace (spec Error handling).
- No comments beyond WHY (repo convention, `docs/conventions/code-conventions.md`); match the existing route file style (see `apps/gui/bridge/routes/decision-trace.ts` for the house comment density).
- cli-test-pattern (`wiki/workflows/cli-test-pattern.md`): injected readers, temp stores via `mkdtempSync`, no timing-tight assertions.

---

### Task 1: `readGuiSavingsEvents` shared reader + `estimateHoursSaved` export

**Files:**
- Create: `apps/gui/bridge/routes/_savings-events.ts`
- Create: `apps/gui/bridge/test/savings-events.test.ts`
- Modify: `packages/pro-analytics/src/roi.ts` (add `estimateHoursSaved`)
- Modify: `packages/pro-analytics/src/index.ts` (export it)
- Modify: `apps/gui/package.json` (add `@megasaver/entitlement`, `@megasaver/pro-analytics` to `dependencies`)

**Interfaces:**

```ts
// apps/gui/bridge/routes/_savings-events.ts
import type { TokenSaverEvent } from "@megasaver/core";
import type { RouteContext } from "../route-context.js";

export type SavingsSnapshot = {
  events: TokenSaverEvent[];
  eventsByProject: Record<string, TokenSaverEvent[]>;
};

export async function readGuiSavingsEvents(ctx: RouteContext): Promise<SavingsSnapshot>;
```

```ts
// packages/pro-analytics/src/roi.ts addition
// Fixed-rate estimate: engineering time saved per dollar of token cost
// avoided, at a flat $60/hr blended rate (matches the rate the CLI's own
// `mega roi` text renderer already uses inline — extracted here so the
// bridge route does not duplicate the constant).
export const HOURLY_RATE_USD = 60;
export function estimateHoursSaved(dollarsSaved: number): number;
```

**Steps:**

- [ ] Read `apps/cli/src/commands/roi.ts` in full to find the exact "time saved" computation the CLI's text renderer uses today (search for `timeSaved` / `hours` in that file and in `apps/cli/src/commands/savings/shared.ts`). If no such computation exists in the CLI today (the GUI's fake `timeSavedHours: 18.2` may have no CLI precedent), use the fixed-rate formula below and note in the PR/commit body that this introduces the constant rather than extracting an existing one — do not claim extraction if there is nothing to extract.

```ts
// packages/pro-analytics/src/roi.ts — append near computeRoi
export const HOURLY_RATE_USD = 60;

export function estimateHoursSaved(dollarsSaved: number): number {
  if (!Number.isFinite(dollarsSaved) || dollarsSaved <= 0) return 0;
  return dollarsSaved / HOURLY_RATE_USD;
}
```

- [ ] Write the failing test for the extraction, `packages/pro-analytics/test/roi.test.ts` (append to existing file):

```ts
describe("estimateHoursSaved", () => {
  it("converts a dollar figure to hours at the fixed rate", () => {
    expect(estimateHoursSaved(120)).toBe(2);
  });
  it("returns 0 for non-positive or non-finite input", () => {
    expect(estimateHoursSaved(0)).toBe(0);
    expect(estimateHoursSaved(-5)).toBe(0);
    expect(estimateHoursSaved(Number.NaN)).toBe(0);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/pro-analytics exec vitest run test/roi.test.ts` — expect FAIL (`estimateHoursSaved` not exported).
- [ ] Implement `estimateHoursSaved` + `HOURLY_RATE_USD` in `roi.ts`, export both from `packages/pro-analytics/src/index.ts` alongside the existing `computeRoi`/`RoiReport`/`PRO_PRICE_USD_PER_MONTH` exports.
- [ ] GREEN: re-run the same vitest command — expect PASS.
- [ ] Add `"@megasaver/entitlement": "workspace:*"` and `"@megasaver/pro-analytics": "workspace:*"` to `apps/gui/package.json` `dependencies` (alphabetical position, matching the existing sorted list).
- [ ] `pnpm install` from repo root (updates the lockfile for the two new GUI edges).
- [ ] Write the failing test `apps/gui/bridge/test/savings-events.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { readGuiSavingsEvents } from "../../bridge/routes/_savings-events.js";
import type { RouteContext } from "../../bridge/route-context.js";

describe("readGuiSavingsEvents", () => {
  it("returns empty snapshot for a registry with no projects", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "gui-savings-events-"));
    const registry = createRegistry({ root: storeRoot });
    const ctx = { registry, storeRoot } as unknown as RouteContext;
    const result = await readGuiSavingsEvents(ctx);
    expect(result).toEqual({ events: [], eventsByProject: {} });
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/gui exec vitest run bridge/test/savings-events.test.ts` — expect FAIL (module not found).
- [ ] Implement `_savings-events.ts` as a direct port of `apps/cli/src/commands/savings/shared.ts`'s `defaultSavingsEventReader` body, reading `ctx.registry` + `ctx.storeRoot` instead of a `resolveStorePath` call (the bridge already resolved `storeRoot` onto `ctx` — no re-resolution needed):

```ts
import { readEvents } from "@megasaver/core";
import type { TokenSaverEvent } from "@megasaver/core";
import type { RouteContext } from "../route-context.js";

export type SavingsSnapshot = {
  events: TokenSaverEvent[];
  eventsByProject: Record<string, TokenSaverEvent[]>;
};

// Mirrors apps/cli/src/commands/savings/shared.ts's defaultSavingsEventReader
// exactly (same @megasaver/core read path) so the GUI and CLI can never
// diverge on which events count toward a savings/ROI/alerts figure.
export async function readGuiSavingsEvents(ctx: RouteContext): Promise<SavingsSnapshot> {
  const events: TokenSaverEvent[] = [];
  const eventsByProject: Record<string, TokenSaverEvent[]> = {};
  if (ctx.registry === undefined) return { events, eventsByProject };
  for (const project of ctx.registry.listProjects()) {
    for (const session of ctx.registry.listSessions(project.id)) {
      const sessionEvents = readEvents({ root: ctx.storeRoot }, project.id, session.id);
      if (sessionEvents.length === 0) continue;
      events.push(...sessionEvents);
      const bucket = eventsByProject[project.name] ?? [];
      bucket.push(...sessionEvents);
      eventsByProject[project.name] = bucket;
    }
  }
  return { events, eventsByProject };
}
```

- [ ] Confirm `readEvents` is exported from `@megasaver/core`'s public surface (`packages/core/src/index.ts`); if it is only re-exported via `context-gate.ts`, import from there instead — check both before writing the import line.
- [ ] GREEN: re-run the same vitest command — expect PASS.
- [ ] Commit:

```bash
git add packages/pro-analytics/src/roi.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/roi.test.ts apps/gui/package.json pnpm-lock.yaml apps/gui/bridge/routes/_savings-events.ts apps/gui/bridge/test/savings-events.test.ts
git commit -m "feat(gui): add shared savings-event reader + hours-saved estimate"
```

---

### Task 2: `handleGetRoi` — real ROI, gated

**Files:**
- Modify: `apps/gui/bridge/routes/analytics.ts` (rewrite `handleGetRoi`)
- Modify: `apps/gui/src/lib/claude-sessions-client.ts` (widen `RoiResponse`)
- Modify: `apps/gui/src/components/roi-analytics-card.tsx` (render the locked state)
- Modify: `apps/gui/test/bridge/analytics-route.test.ts` (real-data + locked assertions)

**Interfaces:**

```ts
// claude-sessions-client.ts
export type RoiResponse =
  | { locked: true; upsellUrl: string }
  | {
      locked: false;
      savedDollars: number;
      timeSavedHours: number;
      roiRatio: number;
      projectedAnnualSavings: number;
    };
```

**Steps:**

- [ ] Write the failing test in `apps/gui/test/bridge/analytics-route.test.ts` (extend the existing `describe` block):

```ts
it("GET /api/roi returns locked:true with no license", async () => {
  server = await start();
  const res = await fetch(`${server.baseUrl}/api/roi`);
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data).toEqual({ locked: true, upsellUrl: "https://megasaver.dev/pro" });
});
```

- [ ] RED: `pnpm --filter @megasaver/gui exec vitest run test/bridge/analytics-route.test.ts` — expect FAIL (current handler returns the old hardcoded shape, no `locked` field).
- [ ] Rewrite `handleGetRoi` in `analytics.ts`:

```ts
import { checkEntitlement } from "@megasaver/entitlement";
import { readGuiSavingsEvents } from "./_savings-events.js";

const UPSELL_URL = "https://megasaver.dev/pro";

export async function handleGetRoi(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  const { computeRoi, estimateHoursSaved, PRO_PRICE_USD_PER_MONTH } = await import(
    "@megasaver/pro-analytics"
  );
  const { events } = await readGuiSavingsEvents(ctx);
  const report = computeRoi(events, { now: ctx.now(), priceUsd: PRO_PRICE_USD_PER_MONTH });
  ctx.sendJson(
    ctx.res,
    200,
    {
      locked: false,
      savedDollars: report.savedSoFar.dollars,
      timeSavedHours: estimateHoursSaved(report.savedSoFar.dollars),
      roiRatio: report.roiSoFar,
      projectedAnnualSavings: report.projectedEnd.dollars * 12,
    },
    ctx.origin,
  );
}
```

- [ ] Check `ctx.now` exists on `RouteContext` (`apps/gui/bridge/route-context.ts`); if the type only has other clock fields, add `now: () => number;` to `RouteContext` and wire it from wherever the context is constructed (`apps/gui/bridge/handler.ts` or `server.ts`) using `Date.now` as the production default — this must match how every other gated route in this codebase gets its clock (check `alerts.ts`'s CLI equivalent for the pattern name, then mirror it here).
- [ ] GREEN: re-run — expect PASS on the locked-path test.
- [ ] Add a second test seeding real events (via `seedWorkspaceCwd`/`seedStore`-equivalent registry helpers already in `test-helpers.ts`) AND a valid test license (check how existing entitlement tests fixture a valid license — search `packages/entitlement/test/` for the pattern, e.g. a self-signed test keypair injected via `publicKey` override) to assert `locked: false` with real numbers; if `checkEntitlement` has no test-injectable `publicKey` path reachable from the bridge, keep this second test at `locked: true` only in this task and open a visible TODO comment (not silent) — do not fabricate a license bypass.
- [ ] Update `RoiResponse` in `apps/gui/src/lib/claude-sessions-client.ts` to the discriminated union above.
- [ ] Update `RoiAnalyticsCard` (`apps/gui/src/components/roi-analytics-card.tsx`) to branch on `roi.locked`:

```tsx
if (!roi) return <></>;
if (roi.locked) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface text-xs">
      <span className="text-text-secondary">ROI reporting is a Mega Saver Pro feature.</span>
      <a href={roi.upsellUrl} className="text-accent font-medium hover:underline">
        Activate a key →
      </a>
    </div>
  );
}
// existing render body, now reading roi.savedDollars etc. unchanged (already locked===false-shaped)
```

- [ ] Run the GUI's existing component test for this card if one exists (`rg -l "RoiAnalyticsCard" apps/gui/test`); update or add one asserting the locked branch renders the upsell link and not `$undefined`.
- [ ] GREEN: full `pnpm --filter @megasaver/gui exec vitest run` for the touched test files.
- [ ] Commit:

```bash
git add apps/gui/bridge/routes/analytics.ts apps/gui/bridge/route-context.ts apps/gui/bridge/handler.ts apps/gui/src/lib/claude-sessions-client.ts apps/gui/src/components/roi-analytics-card.tsx apps/gui/test/bridge/analytics-route.test.ts
git commit -m "feat(gui): wire /api/roi to real computeRoi behind the Pro gate"
```

---

### Task 3: Budget routes + Cache-status route (real data; `clear` removed)

**Files:**
- Modify: `apps/gui/bridge/routes/analytics.ts` (rewrite budget handlers)
- Modify: `apps/gui/bridge/routes/cache.ts` (rewrite `handleGetCacheStatus`, delete `handlePostCacheClear`)
- Modify: `apps/gui/bridge/handler.ts` (remove the `/api/cache/clear` route registration)
- Modify: `apps/gui/src/lib/claude-sessions-client.ts` (widen `BudgetResponse`/`CacheStatusResponse`, remove `postCacheClear`)
- Modify: `apps/gui/src/components/token-budget-card.tsx`, `apps/gui/src/components/cache-doctor-card.tsx` (locked state; remove Clear button)
- Modify: `apps/gui/test/bridge/analytics-route.test.ts`, create `apps/gui/test/bridge/cache-route.test.ts` if none exists (check first)

**Interfaces:**

```ts
// budget: real read/write through @megasaver/core
import { budgetPace } from "@megasaver/pro-analytics"; // lazy
import { budgetStatus, clearBudget, readBudget, writeBudget } from "@megasaver/core";

export type BudgetResponse =
  | { locked: true; upsellUrl: string }
  | { locked: false; monthlyBudgetTokens: number; spentTokens: number; pacePercent: number; isOverBudget: boolean };
```

**Steps:**

- [ ] Write failing tests first (extend `analytics-route.test.ts`):

```ts
it("GET /api/savings/budget returns locked:true with no license", async () => {
  server = await start();
  const res = await fetch(`${server.baseUrl}/api/savings/budget`);
  const data = await res.json();
  expect(data).toEqual({ locked: true, upsellUrl: "https://megasaver.dev/pro" });
});
```

- [ ] RED: run the analytics-route test file — expect FAIL.
- [ ] Rewrite `handleGetBudget`/`handlePostBudget`/`handleDeleteBudget` in `analytics.ts`, replacing the module-level `let storedBudget` entirely:

```ts
export async function handleGetBudget(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  ctx.sendJson(ctx.res, 200, { locked: false, ...(await computeBudgetView(ctx)) }, ctx.origin);
}

export async function handlePostBudget(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { monthlyBudgetTokens?: number };
  if (typeof payload.monthlyBudgetTokens === "number" && payload.monthlyBudgetTokens > 0) {
    const { writeBudget } = await import("@megasaver/core");
    writeBudget(ctx.storeRoot, { version: 1, period: "month", kind: "tokens", amount: payload.monthlyBudgetTokens });
  }
  ctx.sendJson(ctx.res, 200, { locked: false, ...(await computeBudgetView(ctx)) }, ctx.origin);
}

export async function handleDeleteBudget(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  const { clearBudget } = await import("@megasaver/core");
  clearBudget(ctx.storeRoot);
  ctx.sendJson(ctx.res, 200, { locked: false, ...(await computeBudgetView(ctx)) }, ctx.origin);
}

async function computeBudgetView(
  ctx: RouteContext,
): Promise<{ monthlyBudgetTokens: number; spentTokens: number; pacePercent: number; isOverBudget: boolean }> {
  const { budgetStatus, readBudget } = await import("@megasaver/core");
  const { budgetPace } = await import("@megasaver/pro-analytics");
  const status = budgetStatus(ctx.storeRoot);
  const budget = status === "ok" ? readBudget(ctx.storeRoot) : null;
  if (budget === null) {
    return { monthlyBudgetTokens: 0, spentTokens: 0, pacePercent: 0, isOverBudget: false };
  }
  const { events } = await readGuiSavingsEvents(ctx);
  const { forecastSavings } = await import("@megasaver/pro-analytics");
  const forecast = forecastSavings(events, { now: ctx.now(), period: budget.period === "week" ? "week" : "month" });
  const pace = budgetPace(forecast, { kind: budget.kind, amount: budget.amount });
  const spentTokens = budget.kind === "tokens" ? pace.savedUnit : 0;
  return {
    monthlyBudgetTokens: budget.kind === "tokens" ? budget.amount : 0,
    spentTokens,
    pacePercent: Math.round(pace.pctOfGoalSoFar * 100),
    isOverBudget: !pace.onTrack && pace.pctOfGoalSoFar >= 1,
  };
}
```

- [ ] Verify `forecastSavings`'s exact exported signature in `packages/pro-analytics/src/forecast.ts` before finalizing the call above (the plan's shape is inferred from `roi.ts`'s usage at line 25 — confirm parameter names match exactly; adjust the snippet to the real signature if `period` is typed differently).
- [ ] Note: "spentTokens" as a semantic label is `pace.savedUnit`, i.e. tokens SAVED toward the goal, not tokens SPENT against a budget ceiling — this is a rename-in-place inherited from the old fake shape's naming. If this reads as confusing during implementation, flag it in the commit body; do not silently invent a different (unreviewed) metric.
- [ ] GREEN: re-run.
- [ ] Rewrite `handleGetCacheStatus` in `cache.ts`:

```ts
export async function handleGetCacheStatus(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  const { diagnoseCache } = await import("@megasaver/pro-analytics");
  const { proxyUsageEventSchema, proxyUsageLogPath } = await import("@megasaver/llm-proxy");
  const raw = readFileSyncSafe(proxyUsageLogPath(ctx.storeRoot));
  const events = (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = proxyUsageEventSchema.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  const report = diagnoseCache(events, { now: ctx.now() });
  ctx.sendJson(
    ctx.res,
    200,
    {
      locked: false,
      cacheHitRatio: report.hitRate,
      cacheCreationInputTokens: report.cacheCreationTokens,
      cacheReadInputTokens: report.cacheReadTokens,
      churnDetected: report.findings.length > 0,
    },
    ctx.origin,
  );
}
```

- [ ] Confirm `CacheUsageEvent` (the type `diagnoseCache` expects, per `cache-doctor.ts:237`) matches `ProxyUsageEvent` from `@megasaver/llm-proxy` field-for-field; if they differ, check `apps/cli/src/commands/cache.ts` for how the CLI already bridges the two types and copy that exact mapping rather than assuming direct compatibility.
- [ ] Delete `handlePostCacheClear` from `cache.ts` entirely.
- [ ] Remove the `/api/cache/clear` route branch from `apps/gui/bridge/handler.ts` and its `handlePostCacheClear` import.
- [ ] Remove `postCacheClear` from `apps/gui/src/lib/claude-sessions-client.ts`.
- [ ] Remove the "Clear" button and its `onClear` handler from `apps/gui/src/components/cache-doctor-card.tsx`; add the `locked` branch (same pattern as Task 2's ROI card).
- [ ] Update `TokenBudgetCard` (`apps/gui/src/components/token-budget-card.tsx`) with the same `locked` branch.
- [ ] `rg -n "postCacheClear|handlePostCacheClear|/api/cache/clear"` across `apps/gui` — expect ZERO remaining references before proceeding.
- [ ] GREEN: full `pnpm --filter @megasaver/gui exec vitest run` for touched files.
- [ ] Commit:

```bash
git add apps/gui/bridge/routes/analytics.ts apps/gui/bridge/routes/cache.ts apps/gui/bridge/handler.ts apps/gui/src/lib/claude-sessions-client.ts apps/gui/src/components/token-budget-card.tsx apps/gui/src/components/cache-doctor-card.tsx apps/gui/test/bridge/analytics-route.test.ts
git commit -m "feat(gui): wire budget + cache-status to real stores, drop fake cache-clear"
```

---

### Task 4: Alerts, Firewall-status, and FORGE routes (real data)

**Files:**
- Modify: `apps/gui/bridge/routes/analytics.ts` (rewrite `handleGetAlerts`)
- Modify: `apps/gui/bridge/routes/forge.ts` (rewrite all three handlers)
- Modify: `apps/gui/src/lib/claude-sessions-client.ts` (widen `AlertsResponse`/`FirewallStatusResponse`/`ForgeFailuresResponse`)
- Modify: `apps/gui/src/components/forge-learning-card.tsx` (if a firewall-status consumer exists, update it; else skip)
- Modify: `apps/gui/test/bridge/analytics-route.test.ts`, create `apps/gui/test/bridge/forge-route.test.ts` if none exists

**Steps:**

- [ ] Write failing tests first for `/api/alerts` (locked path) and `/api/forge/failures` (real data, no gate):

```ts
it("GET /api/alerts returns locked:true with no license", async () => {
  server = await start();
  const res = await fetch(`${server.baseUrl}/api/alerts`);
  const data = await res.json();
  expect(data).toEqual({ locked: true, upsellUrl: "https://megasaver.dev/pro" });
});
```

- [ ] RED: run — expect FAIL.
- [ ] Rewrite `handleGetAlerts` in `analytics.ts`, mirroring `apps/cli/src/commands/alerts.ts`'s `runAlerts` body (firewall-log read loop, `budgetStatus`/`readBudget`, lazy `detectAnomalies` import):

```ts
export async function handleGetAlerts(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  const { firewallEventSchema, firewallLogPath } = await import("@megasaver/context-gate");
  const raw = readFileSyncSafe(firewallLogPath(ctx.storeRoot));
  const fwEvents = (raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .flatMap((l) => {
      try {
        const parsed = firewallEventSchema.safeParse(JSON.parse(l));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  const { budgetStatus, readBudget } = await import("@megasaver/core");
  const bStatus = budgetStatus(ctx.storeRoot);
  const storedBudget = bStatus === "ok" ? readBudget(ctx.storeRoot) : null;
  const budget = storedBudget === null ? null : { period: storedBudget.period, goal: { kind: storedBudget.kind, amount: storedBudget.amount } };
  const { detectAnomalies } = await import("@megasaver/pro-analytics");
  const { events } = await readGuiSavingsEvents(ctx);
  const report = detectAnomalies(events, fwEvents, budget, { now: ctx.now() });
  ctx.sendJson(
    ctx.res,
    200,
    {
      locked: false,
      spikes: report.findings.filter((f) => f.axis === "traffic" || f.axis === "source"),
      firewallAlerts: report.findings.filter((f) => f.axis === "firewall"),
    },
    ctx.origin,
  );
}
```

- [ ] Check whether `firewallEventSchema`/`firewallLogPath` are exported from `@megasaver/context-gate`'s public `index.ts` (Task's spec references `packages/context-gate/src/firewall-ledger.ts` directly — confirm the barrel re-export exists before writing the import; if absent, add the two-line re-export to `context-gate/src/index.ts` as part of this task, following the append-only pattern used elsewhere in that file).
- [ ] GREEN: re-run.
- [ ] Rewrite `handleGetForgeFailures` in `forge.ts` (ungated):

```ts
export async function handleGetForgeFailures(ctx: RouteContext): Promise<void> {
  if (ctx.registry === undefined) {
    ctx.sendJson(ctx.res, 200, { failures: [] }, ctx.origin);
    return;
  }
  const failures = ctx.registry
    .listProjects()
    .flatMap((p) => ctx.registry!.listFailedAttempts(p.id))
    .filter((f) => !f.convertedToRule)
    .map((f) => ({ id: f.id, pattern: f.failedStep, occurrences: 1, ruleCreated: false }));
  ctx.sendJson(ctx.res, 200, { failures }, ctx.origin);
}
```

- [ ] Rewrite `handlePostForgeLearn` in `forge.ts` (ungated), resolving the owning project before calling `convertFailureToRule`:

```ts
export async function handlePostForgeLearn(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { failureId?: string; ruleTitle?: string };
  if (typeof payload.failureId !== "string" || ctx.registry === undefined) {
    ctx.sendError(ctx.res, 400, "validation_failed", "failureId is required.", ctx.origin);
    return;
  }
  const failure = ctx.registry.getFailedAttempt(payload.failureId as never);
  if (failure === null) {
    ctx.sendError(ctx.res, 404, "not_found", "Unknown failed attempt.", ctx.origin);
    return;
  }
  const title = payload.ruleTitle ?? `Avoid repeating: ${failure.failedStep}`;
  const result = ctx.registry.convertFailureToRule(
    payload.failureId as never,
    { title, rule: title, severity: "warning" },
    () => ctx.now().toString(),
  );
  ctx.sendJson(ctx.res, 200, { learned: true, ruleId: result.rule.id, ruleTitle: result.rule.title }, ctx.origin);
}
```

- [ ] Confirm `getFailedAttempt`'s id parameter type (`FailedAttemptId`, a branded string) and `convertFailureToRule`'s exact third `clock` parameter shape (`registry.ts:120-124`) before finalizing — the snippet above is illustrative; match the real signatures exactly, including whatever `clock` actually returns (the plan guessed `() => string`; verify against `registry.ts:582`'s call site).
- [ ] Rewrite `handleGetFirewallStatus` in `forge.ts` (ungated) per spec Decision 9's renamed shape:

```ts
export async function handleGetFirewallStatus(ctx: RouteContext): Promise<void> {
  const { firewallEventSchema, firewallLogPath } = await import("@megasaver/context-gate");
  const raw = readFileSyncSafe(firewallLogPath(ctx.storeRoot));
  if (raw === null) {
    ctx.sendJson(ctx.res, 200, { enabled: false, detectorsTriggered: 0, blockedAttempts: 0 }, ctx.origin);
    return;
  }
  const detectors = new Set<string>();
  let blocked = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = firewallEventSchema.safeParse(parsed);
    if (!result.success) continue;
    detectors.add(result.data.detector);
    if (result.data.kind === "blocked-read") blocked += result.data.count;
  }
  ctx.sendJson(ctx.res, 200, { enabled: true, detectorsTriggered: detectors.size, blockedAttempts: blocked }, ctx.origin);
}
```

- [ ] Update `apps/gui/src/lib/claude-sessions-client.ts`: widen `AlertsResponse` (if typed) to the discriminated-union `locked` shape; update `ForgeFailuresResponse` unchanged (already matches); rename/retype `FirewallStatusResponse`'s fields to `{ enabled, detectorsTriggered, blockedAttempts }` and fix every call site (`rg -n "activeRules|FirewallStatusResponse" apps/gui/src` to find them — spec notes none currently render in the token-saver page, but re-check before assuming zero UI impact).
- [ ] GREEN: full `pnpm --filter @megasaver/gui exec vitest run` for touched files.
- [ ] Commit:

```bash
git add apps/gui/bridge/routes/analytics.ts apps/gui/bridge/routes/forge.ts packages/context-gate/src/index.ts apps/gui/src/lib/claude-sessions-client.ts apps/gui/test/bridge/analytics-route.test.ts
git commit -m "feat(gui): wire alerts, firewall-status, and forge routes to real stores"
```

---

### Task 5: `mega bench --store-report` (CLI, additive) + `handleGetBenchReport` (GUI, real)

**Files:**
- Modify: `apps/cli/src/commands/bench.ts` (add `--store-report` flag)
- Modify: `apps/cli/test/commands/bench.test.ts` (new flag test)
- Modify: `apps/gui/bridge/routes/analytics.ts` (rewrite `handleGetBenchReport`)
- Modify: `apps/gui/src/components/*` (find the bench-report consumer, if any — `rg -l "fetchBenchReport|BenchReport" apps/gui/src`; the spec's investigation found none wired into `token-saver-page.tsx` today, so this may be a route-only change with no card update required — confirm before assuming a card exists)

**Interfaces:**

```ts
// bench.ts addition — RunBenchInput gains an optional writer
export type RunBenchInput = {
  // ...existing fields...
  storeReport?: boolean;
  writeReportFile?: (path: string, content: string) => void; // reuse existing writeFile injection
};
```

**Steps:**

- [ ] Read the full `runBench` function body in `apps/cli/src/commands/bench.ts` (past line 165, where `composeBenchReport` is called) to find exactly where the composed `BenchReport` object is available, so the new write happens after composition and does not duplicate the pass-running logic.
- [ ] Write the failing test in `apps/cli/test/commands/bench.test.ts`:

```ts
it("writes the report to <store>/pro-analytics/last-bench-report.json when --store-report is set", async () => {
  // arrange a temp store, a valid test license (mirror this file's existing
  // entitled-path test setup), and a trivial deterministic command (e.g. `node -e "console.log(1)"`)
  // act: runBench({ ...baseInput, storeReport: true })
  // assert: writeFile was called once with path ending in "pro-analytics/last-bench-report.json"
  //         and JSON.parse(content) matches the same shape runBench's stdout --json emits
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/commands/bench.test.ts` — expect FAIL.
- [ ] Implement the write, guarded by the existing `writeFile`/`fileExists` injection seam already in `RunBenchInput` (do not add a new fs dependency — reuse `input.writeFile`):

```ts
// inside runBench, after `const report = composeBenchReport(...)`
if (input.storeReport === true) {
  const reportPath = join(input.storeRoot, "pro-analytics", "last-bench-report.json");
  try {
    input.writeFile(reportPath, JSON.stringify(report));
  } catch (err) {
    input.stderr(`warn: could not write --store-report file: ${(err as Error).message}`);
  }
}
```

- [ ] Confirm `input.writeFile`'s real signature does its own directory creation (check the CLI's default `writeFile` implementation, likely near where `--md` is handled) — if it does NOT `mkdir -p` the parent, wrap with the same directory-creation the `--md` path already uses rather than inventing a new one.
- [ ] Wire the `--store-report` boolean flag onto `benchCommand`'s `args` and its `run()` handler, following the exact pattern every other boolean flag in this file uses (`--assert`, `--force`).
- [ ] GREEN: re-run.
- [ ] Rewrite `handleGetBenchReport` in `analytics.ts`:

```ts
export async function handleGetBenchReport(ctx: RouteContext): Promise<void> {
  const ent = checkEntitlement("savings-analytics", { storeRoot: ctx.storeRoot, now: ctx.now });
  if (!ent.entitled) {
    ctx.sendJson(ctx.res, 200, { locked: true, upsellUrl: UPSELL_URL }, ctx.origin);
    return;
  }
  const reportPath = join(ctx.storeRoot, "pro-analytics", "last-bench-report.json");
  const raw = readFileSyncSafe(reportPath);
  if (raw === null) {
    ctx.sendJson(ctx.res, 200, { locked: false, hasReport: false }, ctx.origin);
    return;
  }
  try {
    const report = JSON.parse(raw);
    ctx.sendJson(ctx.res, 200, { locked: false, hasReport: true, report }, ctx.origin);
  } catch {
    ctx.sendJson(ctx.res, 200, { locked: false, hasReport: false }, ctx.origin);
  }
}
```

- [ ] Add `readFileSyncSafe` as a tiny shared helper (`apps/gui/bridge/routes/_read-safe.ts`) if it does not already exist under a different name elsewhere in `apps/gui/bridge` — `rg -n "function readFileSyncSafe\|catch.*ENOENT" apps/gui/bridge` first to avoid duplicating an existing helper.
- [ ] Update `apps/gui/src/lib/claude-sessions-client.ts`'s bench-report response type to the `locked`/`hasReport`/`report` discriminated shape (check if a `fetchBenchReport` client function exists at all; the spec's investigation found no GUI consumer — if true, this task only needs the route + type, no card).
- [ ] GREEN: full test run for touched files.
- [ ] Commit:

```bash
git add apps/cli/src/commands/bench.ts apps/cli/test/commands/bench.test.ts apps/gui/bridge/routes/analytics.ts apps/gui/bridge/routes/_read-safe.ts apps/gui/src/lib/claude-sessions-client.ts
git commit -m "feat(cli,gui): persist and read a real bench report via --store-report"
```

---

### Task 6: Dependency-graph guard for `apps/gui` + full verification + changeset + wiki

**Files:**
- Create: `apps/gui/test/dependency-graph.test.ts`
- Modify: `.changeset/gui-pro-analytics-live-wire.md` (new)
- Modify: `wiki/log.md` (append entry)

**Interfaces:** none new — this task is verification + documentation only.

**Steps:**

- [ ] Write `apps/gui/test/dependency-graph.test.ts`, adapted from `apps/cli/test/dependency-graph.test.ts`'s structure (read that file first for the exact pattern — `declaredDeps()`/`megaDeps()` helpers), asserting `apps/gui/package.json`'s `@megasaver/*` dependency list is exactly the pre-existing set PLUS `@megasaver/entitlement` and `@megasaver/pro-analytics` (enumerate the full expected list explicitly, not just the two new ones, so any future undocumented edge addition also fails this test):

```ts
const ALLOWED_MEGA_DEPENDENCIES = [
  "@megasaver/agent-office",
  "@megasaver/connector-claude-code",
  "@megasaver/connector-generic-cli",
  "@megasaver/connectors-shared",
  "@megasaver/content-store",
  "@megasaver/context-gate",
  "@megasaver/context-pruner",
  "@megasaver/core",
  "@megasaver/daemon",
  "@megasaver/entitlement",
  "@megasaver/evidence-ledger",
  "@megasaver/indexer",
  "@megasaver/llm-proxy",
  "@megasaver/mcp-bridge",
  "@megasaver/memory-graph",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/pro-analytics",
  "@megasaver/proxy-control",
  "@megasaver/shared",
  "@megasaver/stats",
];
```

- [ ] Verify this list against the ACTUAL current `apps/gui/package.json` dependencies (captured during investigation) plus exactly the two new ones — do not guess; read the file at implementation time since other in-flight work may have changed it.
- [ ] RED is not applicable here (this is a new guard, not a TDD unit) — instead run it once immediately after writing to confirm it PASSES against the current state (a guard that fails on the code it is meant to protect is a bug in the guard, fix it before proceeding).
- [ ] Run the full monorepo gate from repo root:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
pnpm verify
```

- [ ] Confirm 60/60 (or whatever the current total is — check the count from a recent `pnpm verify` run first) Turbo tasks green, including `conventions:check`. If the count differs from the historical 60, note the new total; do not assume it is stale.
- [ ] Create the changeset `.changeset/gui-pro-analytics-live-wire.md`:

```markdown
---
"@megasaver/gui": minor
"@megasaver/cli": patch
"@megasaver/pro-analytics": minor
---

Wire the GUI's Pro analytics cards (ROI, budget, alerts, cache doctor,
bench report) to real store reads behind the existing Pro entitlement
gate, replacing hardcoded placeholder constants that every user
(licensed or not) previously saw regardless of actual usage. Adds
`mega bench --store-report` so the GUI's bench card can read the last
real paired-run result. Removes the no-op `POST /api/cache/clear`
route.
```

- [ ] Append a timestamped entry to `wiki/log.md` (top of file, per existing format) summarizing: what was found (six fabricated bridge routes, one missing entitlement dependency), what was fixed, and the verification evidence (`pnpm verify` pass count).
- [ ] Final commit:

```bash
git add apps/gui/test/dependency-graph.test.ts .changeset/gui-pro-analytics-live-wire.md wiki/log.md
git commit -m "test(gui): pin the @megasaver/* dependency allow-list; changeset + wiki"
```
