# Saver Observability — Wave 4 Design

- **Date:** 2026-07-10
- **Risk:** HIGH (hook core path, stats store integrity, connector install path — §12)
- **Scope:** Wave 4 of the saver-savings-gaps program
  ([wiki/syntheses/saver-savings-gaps.md](../../../wiki/syntheses/saver-savings-gaps.md)):
  findings E21–E29, plus one investigation-derived guard test (proxy
  read-index short-circuit).
- **Base:** `main` @ 6c9b34c2 (waves 1–3 merged). Branch
  `feat/saver-observability`.
- **Status:** approved (design gate 2026-07-10, user picked all four
  recommended options)

## Problem

Theme E of the 46-finding audit: **a dead saver looks healthy.** Every
failure mode is fail-open with zero telemetry, and no tool can tell the
difference between "saver compressed nothing because nothing was eligible"
and "saver has been broken for a month."

- E21 — every hook failure is `catch → PASSTHROUGH` with no counter
  (saver.ts:317; saver-run.ts:105-131 top-level swallow, exit 0 always).
  The only telemetry (`recordInvocation`, saver.ts:260) fires *before* the
  work, so a crash still reads as a healthy invocation.
- E22 — `mega doctor` reports "installed" from settings.json presence or a
  hook-log file (doctor.ts:44-64); it never verifies the PostToolUse saver
  exists, resolves, or fires. Liveness data exists in the heartbeat registry
  but doctor ignores it.
- E23 — hooks are registered as bare `mega hooks …`
  (hook-settings.ts:13-16): PATH-dependent, no timeout. One PATH difference
  in the hook shell = exit 127 and everything is silently off.
- E24 — one corrupt per-session summary throws `store_corrupt` from
  `loadOverlaySummary` (stats store.ts:176-190); `appendOverlayEvent`
  appends the event line first, *then* loads the summary (store.ts:205-236),
  so a corrupt summary freezes stats for that session while orphan events
  and chunks keep accumulating. The JSONL reader is corruption-tolerant
  (store.ts:421-445); the summary path is not — an inconsistent asymmetry.
- E25 — the heartbeat `wx` lock has a 10 ms deadline and skips on contention
  (saver-heartbeat.ts:159-182); a stale lock file (holder died) freezes
  liveness telemetry forever, and the 1.13 anomaly alerts then watch frozen
  timestamps.
- E26 — parallel tool calls in one Claude turn race the summary
  read-modify-write (no lock; store.ts:205-236): last writer wins, savings
  undercounted, while both event lines land in the JSONL.
- E27 — `mega hooks status <claude-session-uuid>` always answers "session
  not found": the hook writes the overlay keyspace (keyed by Claude
  transcript UUID) but status/stats read the memory registry (a different
  keyspace).
- E28 — hook telemetry is workspace-key-scoped and never aggregated; nested
  workspace roots (`~`, `~/Desktop`, repo) blind cross-session metrics.
- E29 — hook processes hard-code the default store root; operators using
  `--store` get a split brain (CLI reads store A, hooks write store B).

## Design

Architecture: **heartbeat-spine**. The existing per-workspace heartbeat
registry (`packages/context-gate/src/saver-heartbeat.ts`,
`stats/saver-hook-heartbeats.json`) becomes the single liveness/failure
ledger. No new subsystem; every fix either writes to it, reads from it, or
hardens an existing primitive.

### E21 — failure + fallback + completion telemetry

Heartbeat schema (per-workspace entry) gains optional fields — old files
keep parsing:

```ts
lastCompletionAt?: string;            // end of a successful buildSaverDecision
failures?: { count: number; lastAt: string; lastKind: FailureKind };
daemonFallbacks?: { count: number; lastAt: string };
```

`FailureKind = "payload" | "resolve" | "record" | "unknown"` — coarse
classification of where the catch fired.

- `saver.ts` catch (:317) records a failure heartbeat before returning
  passthrough (best-effort; its own errors swallowed — the §13.4 posture is
  unchanged, we only *count* the fail-open).
- End of a successful `buildSaverDecision` records `lastCompletionAt`.
  `recordInvocation` stays where it is (:260): invocation proves the hook
  fired at all; completion proves it finished. The gap between the two is
  the crash signal.
- `saver-run.ts` `makeRecord` records a `daemonFallbacks` bump whenever a
  daemon handle existed but the POST failed/timed out and the code fell to
  in-process filtering (silent fallback becomes countable; behavior
  unchanged).
- Surfaces: `mega session saver resolve` (new lines) and doctor (E22).

### E25 + E26 — one stale-aware file lock

New utility in `@megasaver/shared`:

```ts
withFileLock(lockPath, { deadlineMs, staleMs }, fn)
```

`wx`-create loop with deadline; on contention, if the existing lock file's
mtime is older than `staleMs` (default 5000 ms), unlink it and retry once.
Returns whether `fn` ran (callers stay best-effort).

- `saver-heartbeat.ts` `withHeartbeatLock` delegates to it (E25: stale lock
  can no longer freeze liveness; the 10 ms deadline stays).
- `appendOverlayEvent` wraps the summary read-modify-write in
  `withFileLock(<summary>.lock, { deadlineMs: 50, staleMs: 5000 })` (E26).
  On lock timeout the summary update is skipped — the event line is already
  in the JSONL and self-heal (E24) reconciles later. Undercount becomes
  transient instead of permanent.

### E24 — self-healing summaries

- `loadOverlaySummary`: on parse/schema failure, instead of throwing
  `store_corrupt`, rebuild the summary from `<id>.events.jsonl` via the
  existing corruption-tolerant reader, atomically rewrite it, and stamp
  `rebuiltAt` (new optional summary field). Only if the *rebuild* also
  fails does it throw.
- `appendOverlayEvent` therefore survives a corrupt summary: event appended,
  summary rebuilt+updated under the E26 lock. A corrupt summary can no
  longer disable compression for a session.
- Wave-2 GC sweep (`maybeRunOverlayGc`) gains bounded drift reconciliation:
  during its existing walk, a summary that fails schema OR whose event
  count is lower than its JSONL line count is rebuilt. Undercount from
  lock-skips (E26) is repaired here permanently.

### E23 — absolute-path + timeout registration

`packages/connectors/claude-code/src/hook-settings.ts`:

- Hook commands are built from the **absolute invoked path** of the running
  CLI (the stable launcher path, e.g. `/opt/homebrew/bin/mega`, resolved
  from `process.argv[1]`; quoted if it contains spaces) + subcommand:
  `"/opt/homebrew/bin/mega" hooks saver`. Rationale: the launcher symlink is
  stable across upgrades, unlike the versioned realpath target.
- Every hook entry gains an explicit `timeout` (saver 30 s; log/intent
  10 s) so a wedged hook cannot stall the agent silently.
- `installClaudeCodeHook` already diffs by value: re-running
  `mega hooks install` migrates existing bare-`mega` entries automatically.
- Uninstall/status match hook entries by command **suffix** (`hooks saver`
  etc.) so both old bare and new absolute/store-baked forms are recognized.

### E29 — install-time store baking

- When the CLI's resolved store root differs from the built-in default,
  install writes `--store <abs>` into all three hook commands:
  `"<abs-mega>" --store "<abs-store>" hooks saver`.
- Doctor compares the store baked into the registered command against the
  store the CLI resolves and reports a mismatch (split-brain detector).

### E22 — doctor becomes a verifier

`mega doctor` gains saver checks (exit non-zero on FAIL-level findings;
warnings don't fail; no auto-fix — each finding prints the repair command):

1. **Registration:** all three hooks present in settings.json; command form
   flagged if bare (pre-E23) or store-mismatched (E29).
2. **Binary:** the registered command's binary path exists and is
   executable; its `--version` matches the running CLI's version (warn on
   mismatch).
3. **Liveness:** per-workspace heartbeat table — last invocation /
   completion / compression / failure counts (E21). "Never fired since
   install" is a warning; "invocations but zero completions" is a FAIL.
4. **Self-test:** spawn the exact registered command with a synthetic
   PostToolUse payload (`session_id: doctor-selftest-<ts>`, small tool
   output) against the real store; assert exit 0 and a heartbeat bump.
   Proves PATH, store wiring, and registration end-to-end. Self-test
   sessions are pruned by the existing GC retention.
5. **Daemon:** `getRunningDaemon` ping result reported (informational —
   in-process fallback is by design).
6. **Store integrity:** bounded scan for corrupt summaries (pre-repair
   count; E24 repairs on next touch) and the E21 failure counters.

### E27 — keyspace union on the read side

`mega hooks status <id>` and `mega session saver status|stats <id>`: when
the id is not in the memory registry, look it up in the overlay keyspace
(`readOverlaySummaryAnyWorkspace`) and render the overlay-backed view,
labeled as a live hook session. No new write path; the hook still registers
nothing (by design — the overlay files ARE the registration).

### E28 — in-store aggregation

`mega hooks status` (no args) gains a cross-workspace aggregate view:
totals summed across all workspace keys under the store root (pattern
mirrors `readAllWorkspaceTokenSaverTotals`), plus the doctor heartbeat
table (E22.3) showing per-workspace recency. Multi-*store-root*
aggregation stays out of scope (see Non-goals); E29 stops new split-brains
from forming.

### Investigation guard test (no production change)

Regression test pinning the MCP proxy read-index short-circuit
(`runOutputPipeline` contentHash check): a file read whose content changed
since the previous read MUST NOT be served the prior chunk set. Derived
from the 2026-07-10 corruption forensics (wiki/log.md investigation entry);
no bug found, this guards the only prior-content path in the codebase.

## Test strategy (RED-first, per finding)

| Finding | Failing test before code |
|---|---|
| E21 | Unit: `buildSaverDecision` with a throwing `record` dep → failure heartbeat written with kind `record`; successful run → `lastCompletionAt` set. `makeRecord` with daemon handle + failing POST → `daemonFallbacks` bump + in-process result. |
| E22 | doctor with registered hooks but empty heartbeat → warning "never fired"; invocations>0 ∧ completions=0 → FAIL; self-test against a temp settings+store fixture spawning a stub command → pass/fail propagates to exit code. |
| E23 | `installClaudeCodeHook` writes absolute invoked path + timeout; re-install over a bare-`mega` settings file migrates it; uninstall removes both forms. |
| E24 | Corrupt summary JSON + valid events.jsonl → `loadOverlaySummary` returns rebuilt summary (with `rebuiltAt`), `appendOverlayEvent` succeeds; today: throws `store_corrupt`. |
| E25 | Stale lock file (old mtime) present → heartbeat write succeeds (today: skipped); fresh lock → still skips (contention semantics kept). |
| E26 | Two interleaved `appendOverlayEvent` calls (second starts between first's load and write, simulated via injected hooks/lock) → summary counts both events (today: lost update). GC drift test: summary count < JSONL lines → rebuilt. |
| E27 | Overlay-only session id → `hooks status <id>` renders overlay view (today: "session not found"). |
| E28 | Two workspace keys with events in one store → `hooks status` aggregate shows the sum. |
| E29 | Non-default store at install → commands carry `--store`; doctor flags command-store ≠ CLI-store. |
| guard | Proxy read-index: changed file content → fresh chunk set, no `unchangedResult` short-circuit. |

Re-baselines expected: `saver-heartbeat.test.ts` (schema growth),
`doctor.test.ts` (new checks), `hook-settings.test.ts` (command format),
`store.test.ts`/`overlay-store.test.ts` (self-heal semantics),
`session-saver-resolve.test.ts` (new telemetry lines).

## Non-goals

- Multi-store-root aggregation (nested store roots stay separate brains;
  E29 prevents new ones — documented limitation).
- Doctor auto-fix (`--fix`); doctor prints repair commands instead.
- New telemetry subsystem / event bus; the heartbeat file is the ledger.
- Changing the fail-open posture itself (hooks still never block the
  agent; §13.4 stands — failures become *visible*, not fatal).
- F30–F34 metrics honesty (wave 5).
- Windows hook-shell nuances beyond command quoting (CI covers both OSes;
  deeper Windows PATH work only if CI proves it needed).

## Package impact / build order

`shared` (withFileLock) → `context-gate` (heartbeat schema + failure
records, E25 lock swap) → `stats` (E24 self-heal, E26 lock, GC drift
reconciliation) → `connectors/claude-code` (E23/E29 install) → `cli`
(E21 wiring, E22 doctor, E27 status union, E28 aggregate, resolve
surfaces). `daemon` untouched (ping reused). Changeset: minor for `cli`,
`context-gate`, `stats`, `shared`, `connector-claude-code`.

## Review sign-offs

- Design gate: user approved (2026-07-10), all four AskUserQuestion
  decisions = recommended options (E23 absolute+timeout, E24/E26
  self-heal+lock, E22 heartbeat+self-test, E29 install-time bake).
- Spec review: pending user review.
- Final: code-reviewer + adversarial critic in fresh contexts (HIGH risk,
  §12).
