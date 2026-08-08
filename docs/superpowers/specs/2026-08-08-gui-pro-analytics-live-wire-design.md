---
feature: gui-pro-analytics-live-wire
date: 2026-08-08
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "1 of 5 (2026-08-08 self-audit batch)"
---

# GUI Pro Analytics Live-Wire — stop the dashboard from lying

## Problem

`mega roi`, `mega savings budget`, `mega alerts`, `mega bench`, and
`mega cache --suffix-audit` are real, entitlement-gated, store-backed
CLI commands (`apps/cli/src/commands/{roi,alerts,bench,cache}.ts`,
`apps/cli/src/commands/savings/budget.ts`) that read `TokenSaverEvent`s,
`FirewallEvent`s, `StoredBudget`, and the proxy usage ledger through
`@megasaver/pro-analytics`. Their compute is real and already reviewed.

But the GUI's Token Saver page renders five cards backed by handlers
that return **literal constants**, never touching the store:

- `handleGetRoi` (`apps/gui/bridge/routes/analytics.ts:11`) — always
  `savedDollars: 142.5, roiRatio: 9.5, …`.
- `handleGetBudget`/`handlePostBudget`/`handleDeleteBudget`
  (`analytics.ts:24-52`) — an in-memory `let storedBudget` module
  variable seeded to `spentTokens: 1250000`; a server restart resets
  it; nothing is read from or written to `budget.json`
  (`packages/core/src/context-gate.ts` re-exports `readBudget` /
  `writeBudget`, both unused by this route).
- `handleGetAlerts` (`analytics.ts:59-68`) — always `{ spikes: [],
  firewallAlerts: [] }`, so the alerts card can never show a real
  anomaly even when `mega alerts` reports one from the same store.
- `handleGetBenchReport` (`analytics.ts:70-82`) — a fixed
  `"ContextOps Standard Suite"` / `88.4%` regardless of whether the
  user has ever run `mega bench`.
- `handleGetCacheStatus`/`handlePostCacheClear`
  (`apps/gui/bridge/routes/cache.ts`) — fixed `cacheHitRatio: 0.94`;
  `handlePostCacheClear` reports `cleared: true` while clearing
  nothing (there is no cache to clear — the field doesn't correspond
  to any real operation `mega cache` exposes).
- `handleGetForgeFailures`/`handlePostForgeLearn`
  (`apps/gui/bridge/routes/forge.ts`) — one hardcoded failure row
  (`"fail-01"`); "Learn" always reports success and never calls
  `registry.convertFailureToRule` or touches `FailedAttempt` storage.
- `handleGetFirewallStatus` (`analytics.ts` neighbor,
  `forge.ts:42-51`) — fixed `activeRules: 12, blockedAttempts: 5`,
  never reading `packages/context-gate/src/firewall-ledger.ts`'s
  `events.jsonl`.

None of these routes call `checkEntitlement("savings-analytics", …)`
(`@megasaver/entitlement`) either — `apps/gui/package.json` does not
even depend on `@megasaver/entitlement` or `@megasaver/pro-analytics`
today. So a **free** GUI user currently sees a permanently-green
"ROI 9.5x" card the CLI would correctly refuse with the Pro upsell
message. This is worse than an empty state: it's a fabricated number
shown to every user regardless of license or usage.

Root cause: these five bridge routes were scaffolded (commit
`71ead119`, "Quantum Context Engine v3", 2026-07-31) as UI-first
placeholders and never wired to the real engines that already existed
at merge time. `apps/gui/test/bridge/analytics-route.test.ts` only
asserts response *shape* (`toHaveProperty("savedDollars")`), so the
placeholder passed CI and was never caught.

## Goal

Replace the six placeholder handlers with real reads through the same
entitlement gate and the same `@megasaver/pro-analytics` /
`@megasaver/core` functions the CLI already uses — so the GUI and the
CLI report the identical number for the identical store, and a
free-tier GUI user sees the same honest upsell state the CLI shows.

- `GET /api/roi` → `checkEntitlement` + `computeRoi` over the real
  `TokenSaverEvent` stream (mirrors `runRoi`).
- `GET/POST/DELETE /api/savings/budget` → `readBudget`/`writeBudget`/
  `clearBudget` (`@megasaver/core`) against `ctx.storeRoot`, gated.
- `GET /api/alerts` → `detectAnomalies` over real events + real
  `firewallEventSchema` rows + real `StoredBudget`, gated.
- `GET /api/bench/report` → read the **last persisted** bench report
  the user generated via `mega bench --md <path>` or a new
  `mega bench --json --store` write-through (Decision 3), gated;
  never fabricate a benchmark that was never run.
- `GET/POST /api/cache/status` (rename `cacheHitRatio` source) →
  `diagnoseCache` + `cacheComposition` over the real proxy usage
  ledger (`@megasaver/llm-proxy` `readProxyUsage`), gated;
  `postCacheClear` is **removed** (Decision 4 — there is nothing to
  clear; the CLI has no equivalent verb).
- `GET /api/firewall/status` → real counts from
  `firewallLogPath`/`firewallEventSchema`, **not gated** (matches
  `mega firewall`, which is free — `apps/cli/src/commands/firewall.ts`
  carries no `checkEntitlement` call).
- `GET /api/forge/failures` → real `registry.listFailedAttempts`
  filtered to `convertedToRule: false`, **not gated** (matches
  `mega fail list`, which is free); `POST /api/forge/learn` calls
  `registry.convertFailureToRule`, matching `mega learn from-failure`.

## Non-Goals

- No new CLI commands, no new `pro-analytics` compute functions —
  every number this ships is already computed and tested by an
  existing CLI command. This is a wiring fix, not a feature.
- No GUI license-activation UI (`mega license activate`) — out of
  scope. The not-entitled response is a structured "locked" JSON
  body; the React card renders it as an upsell card pointing at the
  existing `mega license activate <key>` CLI flow, same copy the CLI
  prints (`ROI_UPSELL` etc., re-exported, not re-typed).
- No bench-run trigger from the GUI (spawning a paired benchmark from
  a browser click is its own HIGH-risk feature — command injection
  surface). The bench card reads the last report the CLI already
  wrote; a "run `mega bench` in your terminal" hint covers the gap.
- No change to any CLI command, `@megasaver/pro-analytics`,
  `@megasaver/entitlement`, or `@megasaver/core` source — read-only
  consumers only, by design (existing compute is trusted; wiring is
  the whole bug).
- No change to `apps/gui/test/bridge/analytics-route.test.ts`'s
  existing shape assertions beyond what real data requires; new tests
  are additive.

## Locked Decisions

1. **Entitlement check lives in the bridge route, not the client.**
   Every gated route calls `checkEntitlement("savings-analytics", {
   storeRoot: ctx.storeRoot, now: ctx.now })` first, exactly like the
   CLI's `runRoi`/`runAlerts`/`runBench`/`runCache`. A locked response
   is `200 { locked: true, upsellUrl: "https://megasaver.dev/pro" }`
   — 200, not 403: a free tier is a normal product state, not an
   error (mirrors the CLI's `return 0` on the ungated path). The React
   card switches on `locked` and never renders a number in that case.
2. **New `apps/gui` dependency: `@megasaver/entitlement`.** Added to
   `apps/gui/package.json` `dependencies` (already a runtime dep
   elsewhere in the monorepo — `@megasaver/cli` depends on it). No
   dependency-graph test exists for `apps/gui` today (only
   `apps/cli/test/dependency-graph.test.ts` enforces an allow-list) —
   Task 6 adds the GUI's own copy of that guard rather than skip the
   protection this repo relies on everywhere else.
3. **`@megasaver/pro-analytics` imports are lazy (`await import(...)`),
   matching the CLI's own "never load Pro compute on the free path"
   rule** (`roi.ts:63`, `cache.ts:...`, `bench.ts:165`). The bridge
   handler checks entitlement, returns the locked body on failure,
   and only then dynamically imports `@megasaver/pro-analytics`.
4. **`POST /api/cache/clear` is deleted, not stubbed differently.**
   Grepping the CLI's `mega cache` surface for a "clear" verb finds
   none; the route was fabricated alongside the fake data. Removing
   an unused, no-op, misleadingly-named endpoint is safer than
   inventing a real behavior for a button nobody asked for. The
   `CacheDoctorCard`'s "Clear" button is removed in the same task
   (Task 3) rather than left calling a 404.
5. **Budget storage: real `readBudget`/`writeBudget`/`clearBudget`
   against `ctx.storeRoot`, replacing the in-memory `let`.** This is
   the same `budget.json` the CLI's `mega savings budget` already
   reads/writes — a GUI-set budget is visible to a subsequent CLI
   call and vice versa, which the in-memory stub could never offer
   (each bridge restart silently reset it).
6. **Bench report persistence: `mega bench` gains an opt-in
   `--store-report` flag that writes `ComposeBenchReport`'s JSON to
   `<storeRoot>/pro-analytics/last-bench-report.json` (atomic write,
   mirrors `content-store`'s `atomicWriteFile` pattern) IN ADDITION
   to existing `--md`/`--json`/stdout behavior — never a replacement.
   `GET /api/bench/report` reads that file if present; absent → `{
   locked: false, hasReport: false }`, rendered as "run `mega bench
   -- <command>` in your terminal to see a report here", never a
   fabricated number. This is the one CLI-side touch in the whole
   feature (additive flag, existing command untouched when the flag
   is omitted) and is scoped to Task 5 alone so the review can
   isolate it.
7. **Firewall and FORGE routes are free, unauthenticated reads** —
   matching their CLI counterparts (`mega firewall`, `mega fail
   list`, `mega learn from-failure` carry no entitlement gate). No
   `checkEntitlement` call on these two routes; Decision 1 applies
   only to the four `savings-analytics`-gated routes.
8. **No caching layer, no polling change.** Existing card `useEffect`
   fetch-once-on-mount pattern (`RoiAnalyticsCard`, `TokenBudgetCard`,
   `CacheDoctorCard`, `ForgeLearningCard`) is preserved; this is a
   backend wiring fix, not a UX redesign. `OverviewPage`'s existing
   4-second poll (`overview-page.tsx:88`) is the precedent for "if a
   future task wants live refresh," but is explicitly NOT added here
   (YAGNI — no user has asked for live-updating ROI).

## Architecture

```
apps/gui/src/components/*.tsx        (unchanged fetch call sites; response shape grows a `locked` field)
  -> apps/gui/src/lib/claude-sessions-client.ts   (response types gain `| { locked: true; upsellUrl: string }`)
       -> apps/gui/bridge/handler.ts               (route table unchanged — same paths/methods)
            -> apps/gui/bridge/routes/analytics.ts     rewritten: handleGetRoi, handleGet/Post/DeleteBudget, handleGetAlerts, handleGetBenchReport
            -> apps/gui/bridge/routes/cache.ts          rewritten: handleGetCacheStatus; handlePostCacheClear DELETED
            -> apps/gui/bridge/routes/forge.ts          rewritten: handleGetForgeFailures, handlePostForgeLearn, handleGetFirewallStatus
                 -> @megasaver/entitlement  checkEntitlement (new GUI dep)
                 -> @megasaver/pro-analytics  computeRoi, detectAnomalies, diagnoseCache, cacheComposition  (lazy import, new GUI dep)
                 -> @megasaver/core  readBudget/writeBudget/clearBudget/budgetStatus, registry.listFailedAttempts/convertFailureToRule  (already a GUI dep)
                 -> @megasaver/context-gate  firewallLogPath/firewallEventSchema  (already a GUI dep, via connector-claude-code chain)
                 -> @megasaver/llm-proxy  readProxyUsage/proxyUsageLogPath  (already a GUI dep)
apps/cli/src/commands/bench.ts   (Task 5 only: additive --store-report flag)
```

Dependency edges added: `apps/gui` → `@megasaver/entitlement`,
`apps/gui` → `@megasaver/pro-analytics`. Both packages already ship
pure, side-effect-light compute (no server, no native deps beyond
`node:crypto` for entitlement's Ed25519 verify) — no new transitive
risk to the GUI's bundle story (`mega gui` ships the bridge as plain
Node, not the browser bundle; the browser bundle never imports these
two packages, only `fetch()`s the bridge).

## Components

1. **`readGuiSavingsEvents(ctx: RouteContext): Promise<SavingsSnapshot>`**
   (new, `apps/gui/bridge/routes/_savings-events.ts`) — the GUI-side
   mirror of the CLI's `defaultSavingsEventReader`
   (`apps/cli/src/commands/savings/shared.ts:28`): enumerate
   `ctx.registry.listProjects()` → `listSessions` → `readEvents`,
   same three-line loop, same `@megasaver/core` re-export. Shared by
   `handleGetRoi` and `handleGetAlerts` (both need the same event
   stream) so the loop is written once, not twice (DRY — the CLI
   itself already has this exact duplication concern solved via one
   shared function per command file; the GUI mirrors that shape).
2. **`handleGetRoi(ctx)`** (rewritten) — `checkEntitlement` →
   not-entitled: `{ locked: true, upsellUrl }`; entitled: lazy-import
   `computeRoi` from `@megasaver/pro-analytics`, call with
   `readGuiSavingsEvents` output and `PRO_PRICE_USD_PER_MONTH`, return
   the real `RoiReport` fields the card already destructures
   (`savedDollars` ← `roiSoFar`'s dollar figure —
   `savedSoFar.dollars`; `roiRatio` ← `roiSoFar`;
   `timeSavedHours`/`projectedAnnualSavings` derived the same way the
   CLI's `mega roi` text renderer does, reusing its math inline since
   the CLI has no exported "hours" helper — Task 1 adds one small
   pure function `estimateHoursSaved(dollarsSaved: number): number`
   shared between the CLI renderer, if the CLI wants it later, and
   this route; lives in `packages/pro-analytics/src/roi.ts` as an
   exported constant-rate helper, NOT duplicated ad hoc in the
   bridge).
3. **`handleGetBudget`/`handlePostBudget`/`handleDeleteBudget`**
   (rewritten) — thin wrappers over `readBudget(ctx.storeRoot)` /
   `writeBudget` / `clearBudget`, gated, returning the same
   `{ monthlyBudgetTokens, spentTokens, pacePercent, isOverBudget }`
   shape the card expects but computed from `budgetPace` (
   `@megasaver/pro-analytics`) over the real event stream instead of
   a hand-rolled percentage.
4. **`handleGetAlerts(ctx)`** (rewritten) — gated; lazy-import
   `detectAnomalies`; assemble real `firewallEvents` (reuse
   `readFirewallLog`-equivalent: read `firewallLogPath(storeRoot)`,
   parse line-by-line through `firewallEventSchema.safeParse`,
   skip-malformed — identical to `alerts.ts:97-107`'s CLI loop) and
   real `StoredBudget` via `budgetStatus`/`readBudget`.
5. **`handleGetBenchReport(ctx)`** (rewritten) — gated; reads
   `<storeRoot>/pro-analytics/last-bench-report.json` if present
   (written by the new CLI flag, Decision 6); `{ locked: false,
   hasReport: false }` if absent; never calls `pro-analytics` compute
   itself (no live run from the GUI, Non-Goal).
6. **`handleGetCacheStatus(ctx)`** (rewritten) — gated; lazy-import
   `diagnoseCache`+`cacheComposition`; read the proxy usage ledger via
   `readProxyUsage`-equivalent (mirrors `cache.ts`'s
   `defaultReadUsageLog` loop: read `proxyUsageLogPath`, parse via
   `proxyUsageEventSchema.safeParse`); `handlePostCacheClear`
   DELETED (Decision 4).
7. **`handleGetForgeFailures(ctx)`** (rewritten, ungated) —
   `ctx.registry.listFailedAttempts(project.id)` across every
   project in the store (mirrors `mega fail list`'s per-project
   loop), filter `convertedToRule === false`, map to `{ id, pattern:
   failedStep, occurrences: 1, ruleCreated: false }` (no stored
   "occurrences" field exists on `FailedAttempt` today — each row is
   one occurrence; the card's "occurrences" label is honest as 1
   unless/until a dedupe feature exists, which this spec does not add).
8. **`handlePostForgeLearn(ctx)`** (rewritten, ungated) — parses
   `{ failureId, ruleTitle }`, resolves the owning project via
   `registry.getFailedAttempt(failureId)`, calls
   `registry.convertFailureToRule(failureId, { title, rule: ruleTitle
   ?? <derived from failedStep> , severity: "warning" }, clock)` —
   the same `ConvertFailureResult` path `mega learn from-failure`
   uses. A missing/already-converted failure id returns
   `404 failed_attempt_not_found`, not a fabricated success.
9. **`handleGetFirewallStatus(ctx)`** (rewritten, ungated) — read
   `firewallLogPath(ctx.storeRoot)`, parse via
   `firewallEventSchema.safeParse` line-by-line, `activeRules` = 0
   (there is no "rules" concept in `FirewallEvent` — Decision 9:
   rename the field client-side, see below), `blockedAttempts` = Σ
   `count` where `kind === "blocked-read"`, `enabled` = the log file
   exists (mirrors the CLI's `defaultReadFirewallLog` absent-file
   handling: `null` → `enabled: false`, not an error).

**Decision 9 (field-name honesty fix, folded into Task 4):** the
existing `FirewallStatusResponse` shape (`activeRules`,
`blockedAttempts`) implies a rules-engine concept the firewall ledger
does not have (`firewallEventSchema` has no "rule" field — only
`kind`/`detector`/`count`, per F-FW-1's value-free-by-construction
design). Task 4 renames the bridge response to `{ enabled: boolean,
detectorsTriggered: number, blockedAttempts: number }` (
`detectorsTriggered` = distinct `detector` values seen, an honest
question this data CAN answer) and updates
`apps/gui/src/lib/claude-sessions-client.ts`'s `FirewallStatusResponse`
type + any consumer to match. No firewall UI card currently renders
this field in the token-saver page (`rg` found none), so this is a
type-and-route-only rename with no visible UI regression risk.

## Error handling

- `checkEntitlement` never throws (fail-closed by construction,
  `entitlement.ts` catches internally) — its `{ entitled: false }`
  result is the only "no license" signal; routes never need a
  try/catch around the gate itself.
- Store-read failures (corrupt `budget.json`, unreadable
  `usage.jsonl`, malformed `events.jsonl` lines) degrade exactly like
  their CLI counterparts: corrupt budget → `{ locked: false, status:
  "corrupt" }` (mirrors `runBudgetShow`'s `status === "corrupt"`
  branch), malformed JSONL lines are skipped per-line (never abort
  the whole read), absent files render as empty/zero states, never a
  500.
9. **`--store-report` write failure** (Task 5's one CLI change) is
   best-effort: caught, logged to stderr as a warning, never changes
   `mega bench`'s existing exit code — the report file is a nice-to-
   have, not part of the command's contract (mirrors the existing
   `--md` write's own best-effort framing in `bench.ts`).
- Every rewritten route keeps the existing `handleCaughtError`
  wrapper (`apps/gui/bridge/error-mapping.ts`) as the outermost catch,
  matching every other bridge route's convention — an unexpected
  throw still returns a structured `BridgeErrorCode` body, never a
  raw stack trace to the browser.

## Security & privacy

- No new write surface beyond what already existed as a fake no-op:
  `POST /api/savings/budget` now performs a REAL write to
  `budget.json` under the resolved store root — same trust boundary
  as every other bridge POST route (loopback-only per `mega gui`'s
  existing bind + token model; no new auth surface introduced here).
- `checkEntitlement`'s license file read (`readLicenseFile`) is local
  disk only, no network call, matching the CLI.
- No secret data enters any new response body: ROI/budget/alerts/
  cache/bench numbers are aggregate counts and dollar estimates, the
  same class of data the existing (fake) responses already exposed
  the *shape* of. FORGE failure rows reuse `FailedAttempt.failedStep`
  text, which is already displayed via `mega fail show` — no new
  exposure, same trust level as existing CLI output.

## Testing

| Unit | Test |
|---|---|
| `readGuiSavingsEvents` | mirrors `defaultSavingsEventReader`'s own test fixture shape; empty registry → `{ events: [], eventsByProject: {} }` |
| `handleGetRoi` | not-entitled → `{ locked: true }`, no `pro-analytics` import (spy-asserted, mirrors `runRoi`'s free-path spy test); entitled + seeded events → real `RoiReport`-derived numbers match a hand-computed fixture |
| `handleGet/Post/DeleteBudget` | round-trip: POST a budget, GET returns it, matches what a subsequent `mega savings budget show --store <same dir>` would print (a literal cross-surface test: spawn the built CLI against the same temp store, per `smoke-cli` precedent used elsewhere in this repo) |
| `handleGetAlerts` | gated; malformed firewall JSONL line skipped, not thrown; insufficient-history path returns the same `insufficient-history` status shape the CLI's `AlertsReport` carries |
| `handleGetBenchReport` | no report file → `{ hasReport: false }`; a `mega bench --store-report` write is read back byte-identical |
| `mega bench --store-report` (Task 5) | writes `last-bench-report.json`; omitting the flag writes nothing (regression guard: existing `bench.test.ts` assertions about stdout/exit code unchanged) |
| `handleGetCacheStatus` | gated; empty usage ledger → `status: "no-usage"`, never a fabricated hit ratio |
| `handleGetForgeFailures`/`handlePostForgeLearn` | ungated; converts a real seeded `FailedAttempt`; already-`convertedToRule` failures excluded from the list; unknown id → 404 |
| `handleGetFirewallStatus` | ungated; absent log → `enabled: false`; seeded `blocked-read`/`redacted` events produce correct `detectorsTriggered`/`blockedAttempts` counts |
| dependency-graph guard (Task 6) | `apps/gui`'s own allow-list test (new, mirrors `apps/cli/test/dependency-graph.test.ts`) pins `@megasaver/entitlement` + `@megasaver/pro-analytics` as the only two NEW `@megasaver/*` edges this feature adds |
| React cards (`RoiAnalyticsCard` etc.) | `locked: true` response renders the upsell copy, not `undefined`/`NaN`; existing render-tests extended, not replaced |

No timing-tight tests; all assertions are structural/value fixtures,
consistent with the repo's `verification-before-completion` history
of flaky timing guards.

## Risk & process

**MEDIUM.** Every number this ships is already-reviewed `pro-analytics`
/ `core` compute; the change is a consumption-boundary fix (bridge
routes stop fabricating and start reading), not new business logic.
The one net-new logic surface — Task 5's `--store-report` flag on an
existing Pro-gated CLI command — is small, additive, and best-effort
on failure. Escalation trigger: if implementation needs to touch
`checkEntitlement`'s verification logic, the license file format, or
add a new `ProFeature` key, STOP and re-classify HIGH (license/
entitlement integrity is a CRITICAL-adjacent surface per
`docs/conventions/risk-modes.md`). Required reviewer: `code-reviewer`.
Regression evidence: `mega roi`/`mega savings budget`/`mega alerts`/
`mega cache --suffix-audit` CLI output is byte-for-byte unchanged
(this spec touches zero CLI source outside the one additive bench
flag); full `pnpm verify` green.

## Dependencies / build order

Independent of the other 2026-08-08 self-audit pairs. No shared
ownership conflicts: this is the only pair touching
`apps/gui/bridge/routes/{analytics,cache,forge}.ts`. Should land
before `2026-08-08-doctor-gui-bridge` (build 5) since both touch
`apps/gui/bridge/route-context.ts`'s handler-registration list and a
combined rebase is cheaper done in build order.
