---
feature: doctor-gui-bridge
date: 2026-08-08
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "5 of 5 (2026-08-08 self-audit batch)"
---

# Doctor → GUI Bridge — surface `mega doctor`'s real diagnostics in the dashboard

## Problem

`runSaverChecks` (`apps/cli/src/commands/doctor-saver.ts:269-540`) is
the single most thorough health check this product has: it verifies
hook registration completeness (log/saver/intent, 0-3/3), the
registered hook binary actually exists and is executable, its
reported `--version` matches the running CLI, whether the saver hook
and the CLI resolve the SAME store (split-brain detection), a real
LIVENESS check from the heartbeat ledger (stuck/crashed invocations,
not just "installed"), an ACTIVE self-test that spawns the exact
registered hook command against a synthetic payload and confirms both
an invocation AND a completion heartbeat advance, daemon reachability,
proxy route health (including a "something keeps rewriting your
settings" churn counter), and per-workspace net-effect verdicts
(positive/negative/unknown savings, 7-day window). Every one of these
is real, store-backed, already-reviewed diagnostic logic — not a
placeholder.

None of it reaches the GUI. `OverviewPage`'s "System readiness"
section (`apps/gui/src/views/overview-page.tsx:118-166`) independently
probes five much shallower signals — `fetchClaudeHookStatus`,
`fetchProxyStatus`, `fetchMcpStatus`, `fetchDaemonStatus`,
`fetchWorkspaceIndex` — each answering only "is X installed/running,"
never "is X actually WORKING" (the self-test's whole point: a hook can
be installed, the binary can exist, and the hook can still be silently
broken — wrong store, crashing before completion, stale version —
none of which the GUI's shallow probes can detect, but `mega doctor`
already does, today, for the CLI user only). A GUI-only user (someone
who ran `mega gui` and never runs `mega doctor` by hand) has
structurally less visibility into whether their saver is actually
working than a CLI user does — the opposite of what a dashboard is
for.

`apps/gui` cannot import `apps/cli` (agent-agnostic-core invariant,
`docs/conventions/mission.md`: "Every connector is a thin adapter...
never let agent-specific logic bleed into Core" — and structurally,
the dependency graph only runs `cli → gui`, e.g. `mega gui` boots the
bridge, never the reverse). `runSaverChecks` currently lives in
`apps/cli`, so it is unreachable from the GUI bridge as-is — this is
the actual reason the GUI has never had this data, not an oversight
in wiring a route.

## Goal

Relocate `runSaverChecks`' orchestration (not its CLI-only concerns —
see Non-Goals) to a shared package both `apps/cli` and `apps/gui`
already depend on, expose it as `GET /api/doctor` on the GUI bridge,
and add a "Saver health" panel to the dashboard rendering the same
six check categories `mega doctor` already prints, in the same
pass/warn/fail vocabulary — so a GUI-only user can see, at a glance,
everything a CLI user already gets from `mega doctor`.

## Non-Goals

- **No change to `mega doctor`'s CLI output or exit-code contract.**
  `doctor.ts`'s `runChecks`/`renderReport`/`exitCodeFor` and the
  `doctorCommand` handler are UNTOUCHED; only `runSaverChecks`'
  internals are relocated, with `doctor-saver.ts` becoming a thin
  re-export so every existing CLI import keeps working.
- **The self-test's hook-binary spawn stays CLI-shape-aware but
  bridge-safe.** The self-test (`runSaverChecks`' E22.4) spawns the
  REGISTERED hook command (`sh -c <cmd>` / `spawnSync` on win32) — this
  is process execution, already gated by nothing more than "does the
  registered command exist," and already runs unattended today via
  `mega doctor`. The GUI bridge is LOCAL-ONLY (loopback + token, same
  trust boundary as every other GUI mutation route) so running the
  identical self-test from a GUI request carries no NEW trust
  boundary — but this spec makes the self-test OPT-IN per request
  (Locked Decision 4) rather than automatic on every page load, since
  a spawn on every dashboard poll is wasteful and unlike every other
  GUI panel's read-only default.
- **No new persistence.** `refreshNetEffectVerdicts`' existing
  best-effort `writeNetEffectRecord` side effect is preserved exactly
  (it already does this from the CLI path today) — this spec adds no
  new writes beyond what `runSaverChecks` already performs.
- **No change to `checkNode`/`checkPlatform`/`checkCwd`.** These three
  checks are meaningless in a GUI-bridge context (`process.cwd()` is
  the bridge server's cwd, not the user's active workspace; Node
  version is the bridge's own runtime, already implicitly satisfied by
  the fact the bridge is running) — the GUI panel surfaces ONLY the
  saver-specific checks (`runSaverChecks`' six categories +
  `checkSettingsPermissions` + `checkHookTelemetry`), never the
  environment triad.
- **No auto-refresh/polling of the self-test specifically** — the
  panel's other (non-spawning) checks may poll on the existing
  dashboard cadence if a future task wants that, but the self-test
  itself is manually-triggered only in v1 (Locked Decision 4).

## Locked Decisions

1. **Relocation target: `@megasaver/context-gate`, with
   `hookCommandMatches` INJECTED, not imported.** Verified during
   spec-writing: `packages/core/package.json` already depends on
   `@megasaver/context-gate` (the BB12 extraction — core re-exports
   context-gate's orchestrator surface). `@megasaver/connector-claude-code`
   depends on `@megasaver/core`. So `context-gate → connector-claude-code
   → core → context-gate` would be a real dependency CYCLE if
   `context-gate` imported `hookCommandMatches` directly — this is
   NOT a theoretical risk to "confirm at implementation time," it is
   confirmed now, from the two packages' actual `package.json` files.
   `readDiscovery` (`@megasaver/daemon`) and
   `readControlState`/`readRuntimeState` (`@megasaver/proxy-control`)
   are SAFE — neither package depends on `core` or `context-gate`
   (daemon depends on nothing workspace-internal; proxy-control
   depends only on `@megasaver/llm-proxy`, which itself has no
   `core`/`context-gate` edge) — so those two become real new
   dependency edges on `context-gate`'s `package.json`, added cleanly.
   `hookCommandMatches` alone is threaded through `DoctorSaverDeps` as
   an injected function parameter (`deps.hookCommandMatches`,
   REQUIRED — no default in the relocated module, since a default
   would need to import the very package that creates the cycle);
   `apps/cli`'s call site supplies the real
   `@megasaver/connector-claude-code` implementation (it already
   depends on that package directly, no cycle there — `apps/cli` is a
   leaf app, not a workspace package other packages depend on); the
   GUI bridge supplies the SAME real implementation, since
   `apps/gui/package.json` ALSO already depends on
   `@megasaver/connector-claude-code` directly (confirmed) — both
   callers pass the real function, so behavior is identical to today;
   only a NEW consumer of the relocated module (hypothetically, one
   without that dependency) would need a fake, and this spec has none.
   Both `apps/cli` and `apps/gui` ALREADY depend on
   `@megasaver/context-gate` (confirmed: `apps/cli/test/dependency-graph.test.ts`'s
   allow-list, `apps/gui/package.json`'s dependencies) — this
   relocation adds **zero new workspace edges to either app**; it adds
   exactly two new edges to `context-gate`'s OWN `package.json`
   (`@megasaver/daemon`, `@megasaver/proxy-control`), neither of which
   creates a cycle (verified above).
2. **CLI-only pieces stay in `apps/cli`.** The version sub-check
   (`runningCliVersion()`, reads the CLI's OWN package.json/build-time
   constant — meaningless for a bridge process, which has no
   equivalent "am I the right version" question against a hook binary
   built for a different install) and the raw `spawn`/`spawnSync`
   process-execution wrapper (`defaultSpawn`, platform-specific shell
   invocation) are INJECTED into the relocated function as parameters,
   not hardcoded — `runSaverChecks` becomes `runSaverChecks(deps)`
   where `deps.spawn` and `deps.cliVersion` are supplied differently
   by each caller: `apps/cli/src/commands/doctor-saver.ts` keeps
   supplying its real `defaultSpawn`/`runningCliVersion()` (unchanged
   behavior); the GUI bridge supplies its OWN spawn wrapper (Node's
   `child_process`, same underlying primitive, bridge-local
   implementation) and OMITS `cliVersion` (the version sub-check
   already degrades gracefully to "skipped" when `cliVersion` is
   `undefined`, per the existing code's own handling at
   `doctor-saver.ts:337-338` — no new skip logic needed, this is
   already the function's documented behavior for an unresolvable
   version).
3. **`GET /api/doctor?selfTest=false` (default) returns every check
   EXCEPT the self-test; `GET /api/doctor?selfTest=true` runs the full
   set including the spawn-based self-test.** Matches Locked Decision
   in Non-Goals (opt-in spawn). The route accepts the query param
   rather than requiring a POST, since running the full set is still a
   read-then-report operation with a documented, bounded side effect
   (the heartbeat bump the self-test intentionally causes, same as
   today's CLI behavior) — not a state MUTATION in the sense other
   POST routes are (no user data changes, only diagnostic telemetry
   that already exists for exactly this purpose).
4. **Response shape: the same `Check[]` array `mega doctor` already
   defines** (`{ key, value, pass, reason? }`, `doctor.ts:9-14`) —
   reused verbatim, not a new response schema. The GUI panel renders
   it with the exact same pass/warn/fail vocabulary
   (`pass:true` + `reason` starting with `"warn:"` = amber;
   `pass:true` + no reason = green; `pass:false` = red) `mega
   doctor`'s own text renderer already encodes, so a user who has seen
   `mega doctor`'s CLI output recognizes the GUI panel instantly.
5. **Free tier, no entitlement gate** — `mega doctor` is free; its GUI
   mirror stays free (same reasoning as `mega why`/`mega review`: this
   is operational health, not a savings-analytics Pro surface).

## Architecture

```
apps/cli/src/commands/doctor-saver.ts   (thin re-export: `export { runSaverChecks, refreshNetEffectVerdicts, type DoctorSaverDeps } from "@megasaver/context-gate";`
                                          + apps/cli's own defaultSpawn/runningCliVersion, now passed as deps at the doctor.ts call site)
  <- moved from ->
packages/context-gate/src/saver-doctor.ts   (new: the relocated orchestration, deps.spawn/deps.cliVersion now REQUIRED-when-used injected params, no default)

apps/gui/bridge/routes/doctor.ts   (new)
  handleGetDoctor(ctx) -> runSaverChecks({ storeRoot: ctx.storeRoot, spawn: guiSpawn, settingsPath: ctx.claudeSettingsPath, ...(selfTest ? {} : { skipSelfTest: true }) })
       + checkSettingsPermissions/checkHookTelemetry (small, non-CLI-coupled — call directly, no relocation needed, check whether these two need relocating too or can be trivially re-derived bridge-side)

apps/gui/src/lib/claude-sessions-client.ts   fetchDoctorReport(selfTest?: boolean): Promise<Check[]>
apps/gui/src/components/saver-doctor-panel.tsx   (new) -- rendered on OverviewPage or TokenSaverPage (Locked Decision TBD in Task, see Components)
```

## Components

1. **`packages/context-gate/src/saver-doctor.ts`** (new file, receives
   the relocated body of `runSaverChecks`/`refreshNetEffectVerdicts`/
   their private helpers `newestTs`/`registeredCommand`/`firstToken`/
   `bakedStore` verbatim). Add one new optional flag to
   `DoctorSaverDeps`: `skipSelfTest?: boolean` (default `false`,
   preserving `apps/cli`'s existing always-run behavior unchanged) —
   when `true`, the E22.4 self-test block is skipped entirely (no
   spawn), matching Locked Decision 3's default-off GUI behavior. ALSO
   add one new REQUIRED (no default) field: `hookCommandMatches:
   (command: string, subcommand: string) => boolean` — the exact
   signature `registeredCommand`'s inner loop already calls it with
   (`doctor-saver.ts`'s current body, the line importing
   `hookCommandMatches` from `@megasaver/connector-claude-code`
   directly). Making it required (not defaulted) is deliberate: the
   relocated module in `context-gate` must never import
   `connector-claude-code` itself (Locked Decision 1's cycle), so
   there is no safe default to fall back to — every caller supplies it
   explicitly, which is a compile-time guarantee (TypeScript required
   field) that nobody forgets the wiring, rather than a silent runtime
   gap.
2. **`apps/cli/src/commands/doctor-saver.ts`** (rewritten to a thin
   re-export, per Locked Decision 2) — `doctor.ts`'s call site
   (`runSaverChecks()`, no args today, relying on all-default deps)
   continues to work unchanged since every existing default is
   preserved in the relocated module.
3. **`handleGetDoctor(ctx: RouteContext): Promise<void>`** (new,
   `apps/gui/bridge/routes/doctor.ts`) — reads `ctx.query.get("selfTest")
   === "true"`, calls the relocated `runSaverChecks` with
   `{ storeRoot: ctx.storeRoot, spawn: guiSpawn, skipSelfTest:
   !selfTest }` (no `cliVersion` — Locked Decision 2), ALSO composes
   `checkSettingsPermissions`/`checkHookTelemetry` from `doctor.ts` —
   check whether these two small pure-ish functions need the same
   relocation treatment (they read a settings path + hook log path,
   no CLI-specific state) or can be safely duplicated/re-derived
   bridge-side without drift risk; PREFER relocating them alongside
   `runSaverChecks` into the same new `saver-doctor.ts` file for one
   consistent source of truth, since `doctor.ts` itself already
   re-exports whatever it needs.
4. **`guiSpawn`** (new, small, `apps/gui/bridge/routes/doctor.ts`) —
   the bridge's own `spawnSync`-based implementation, structurally
   identical to `apps/cli/src/commands/doctor-saver.ts`'s
   `defaultSpawn` (same `sh -c`/win32-shell branching) but declared
   locally in the GUI bridge rather than imported from `apps/cli`
   (which the GUI cannot depend on) — this is the one deliberate,
   justified small duplication in this spec (Global Constraints in
   the plan calls this out explicitly so it is not mistaken for an
   accidental copy-paste).
5. **`fetchDoctorReport(selfTest?: boolean): Promise<Check[]>`** (new,
   `apps/gui/src/lib/claude-sessions-client.ts`) — `getJson<Check[]>(
   selfTest ? "/api/doctor?selfTest=true" : "/api/doctor")`.
6. **`SaverDoctorPanel`** (new, `apps/gui/src/components/saver-doctor-panel.tsx`)
   — fetches on mount with `selfTest=false` (cheap, no spawn); renders
   each `Check` as a row (key, value, pass/warn/fail badge, reason);
   a "Run full self-test" button re-fetches with `selfTest=true` and
   updates only the self-test-dependent rows (or the whole list —
   simplest correct behavior: re-fetch and replace the entire list,
   since the response is small and this is not a hot path). Placed on
   `OverviewPage`, ABOVE or ADJACENT to the existing "System
   readiness" section (Task-time decision: consider whether this
   REPLACES that section's shallower checks or sits alongside it as a
   deeper drill-down — leaning toward "alongside, collapsed by
   default" to avoid a large disruptive redesign of an existing,
   working section in a MEDIUM-risk wiring spec; a full merge/replace
   of `OverviewPage`'s readiness section is a separate, larger UX
   decision this spec does not make unilaterally).

## Error handling

- Every check inside `runSaverChecks` already has its own internal
  fail-open handling (documented throughout `doctor-saver.ts`'s
  comments — "fail-open," "best-effort," "must never crash doctor") —
  none of that changes; the relocation preserves every one of those
  guarantees verbatim.
- `handleGetDoctor` itself wraps the whole composition in the
  existing `handleCaughtError` convention (matches every other bridge
  route) — an unexpected throw from a check that somehow escapes its
  own internal handling still returns a structured error, never a
  raw crash to the browser.
- A `skipSelfTest: true` run must produce the EXACT SAME output for
  every non-self-test check as a CLI `mega doctor` run against the
  same store state (byte-for-byte check array, self-test/self-test-
  version rows simply absent) — this equivalence is the core
  regression guarantee and gets its own explicit test (Testing table).

## Security & privacy

- No new trust boundary: the GUI bridge is loopback-only + token-
  authed, same as every other route; the self-test spawn (opt-in,
  Locked Decision 3) runs the SAME command `mega hooks install`
  already registered in the user's own Claude settings — it is not
  running arbitrary user input, it is running the exact command the
  user's own prior `mega hooks install` (or GUI-driven install) wrote.
- `settingsPath`/hook-log paths read here are the SAME ones the
  existing `AgentSetupDoctor`/`fetchMcpStatus` routes already read on
  this bridge — no new file-access surface.

## Testing

| Unit | Test |
|---|---|
| relocated `runSaverChecks` | full existing `apps/cli/test`'s doctor-saver test suite (whatever file covers it today — find via `rg -l "runSaverChecks" apps/cli/test`) re-run UNCHANGED against the new import path (`@megasaver/context-gate`) — zero behavioral diffs; this is the primary regression gate for the relocation itself |
| `skipSelfTest: true` | returns every check except `saver-self-test`/`saver-hook-version`'s spawn-dependent rows; the non-spawn checks (registration, liveness, daemon, proxy-route, net-effect) are UNCHANGED whether `skipSelfTest` is true or false, for the same fixture state |
| `apps/cli/src/commands/doctor-saver.ts` re-export | `mega doctor`'s CLI output is byte-for-byte identical before/after the relocation (golden-fixture or direct before/after diff against a seeded store) |
| `handleGetDoctor` | `GET /api/doctor` (no query) never spawns (spy-asserted `guiSpawn` not called); `GET /api/doctor?selfTest=true` does spawn and its result matches `runSaverChecks({ skipSelfTest: false, ... })`'s own output for the same fixture |
| `guiSpawn` | structurally mirrors `defaultSpawn`'s platform branching (win32 vs POSIX) — a minimal test per branch, injected `process.platform` |
| `SaverDoctorPanel` | renders pass/warn/fail badges matching the `Check[]` fixture; "Run full self-test" button triggers the `selfTest=true` fetch, not the default one |

No timing-tight tests; the self-test's own spawn timeout
(`SELF_TEST_TIMEOUT_MS`) is unchanged and already covered by the
existing CLI-side test suite being relocated, not re-invented.

## Risk & process

**MEDIUM.** This relocates already-shipped, already-reviewed
diagnostic logic to a shared package and adds a read-mostly bridge
route + panel — no new business logic, no new mutation surface beyond
what `mega doctor` already performs today for the CLI user. Required
reviewer: `code-reviewer`. Escalation trigger: if the relocation
surfaces an actual dependency CYCLE (`context-gate` cannot cleanly
depend on `connector-claude-code`/`daemon`/`proxy-control` for some
structural reason not visible during spec-writing), STOP — that is a
deeper architectural question (which package should own cross-cutting
doctor orchestration) belonging to its own design discussion, not a
silent workaround in this plan. Regression evidence: `mega doctor`
CLI output byte-identical pre/post relocation (Testing table); full
`pnpm verify` green including both `apps/cli` and `apps/gui`'s
dependency-graph guards.

## Dependencies / build order

Independent of the other four 2026-08-08 pairs at the code level (no
shared files with builds 1-4). Should land AFTER
`gui-pro-analytics-live-wire` (build 1) if both are worked in the same
session — build 1 also touches `apps/gui/bridge/handler.ts`'s route-
registration list and `apps/gui/package.json`'s dependency block; a
combined rebase is cheaper done in build order (same note this spec's
sibling, build 1, already makes about build 5).
