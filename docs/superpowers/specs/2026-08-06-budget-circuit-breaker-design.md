---
feature: budget-circuit-breaker
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "5 of 11 (next-wave batch)"
---

# Budget Circuit Breaker (C1)

## Problem

Per-session and per-task spend is invisible while it happens: the
same task varies up to ~30x in tokens and budgets are exceeded
because nothing warns mid-session
(`wiki/syntheses/vibe-coding-pains-2026.md` P3, C1). Mega Saver holds
the receipts — the overlay `TokenSaverEvent` ledger
(`packages/stats/src/event.ts`, measured `rawTokens`/`returnedTokens`)
and proxy metering rows (`packages/llm-proxy/src/usage-event.ts` via
`appendProxyUsage`) — but no consumer compares a live session's burn
against a limit before the money is gone.

## Goal

1. `mega budget set <n-tokens> [--task <label>] [--session <id>]`
   persists per-workspace token budgets (session-default, per-session,
   per-task-label) in the store.
2. A hook-side check piggybacked on the existing PostToolUse saver
   path warns at 80% and 100% of the effective budget via
   `hookSpecificOutput.additionalContext` — warn-only, fail-open,
   zero added awaited I/O before the hook's stdout write.
3. A variance alarm: current session burn ≥ 3x the median of
   same-label sibling sessions (simple percentile math, no ML;
   sample definition per Locked Decision #5).
4. `mega budget status` renders the table: scope, limit, measured
   burn, coverage, % used, median, alarms.

## Non-Goals

- Hard-blocking tool calls at 100%. v1 is warn-only; a deny at the
  PreToolUse gate is an explicit later opt-in (separate spec).
- Estimated burn. No bytes/4, no extrapolation — measured token
  receipts only (absence = UNMEASURED, reported as coverage).
- Per-session attribution of proxy receipts: `workspaceKey` on
  `proxyUsageEventSchema` is reserved-but-never-stamped (F33), so
  `mega budget status` shows billed totals as a store-wide line only.
- Dollar budgets, weekly/monthly periods, auto task labeling,
  GUI surface, daemon route changes.
- Touching the Pro savings budget (`packages/stats/src/budget.ts`,
  `mega savings budget`) — that is a savings GOAL; this is a spend
  CIRCUIT BREAKER. Separate module + command, cross-linked help text.

## Locked Decisions

1. **Burn = measured overlay receipts.** Session burn is
   Σ `returnedTokens` over `readOverlayEvents(store, workspaceKey,
   liveSessionId)` rows (compression AND `kind: "expansion"` rows —
   both were delivered). Events without `returnedTokens` count as
   `unmeasuredEvents` and are surfaced as coverage, never estimated
   (mirrors `deltaTokensOf` discipline, `packages/stats/src/event.ts`).
   Consequence: burn is a floor (passthrough outputs and prompts are
   not in the ledger) — the breaker can warn late, never falsely early.
2. **Budget precedence:** explicit `sessions[id]` > `tasks[label]`
   (via `labels[id]`) > `sessionDefault`. A task budget binds
   per session-run (one labeled session), matching the ~30x
   per-task-run variance framing; cumulative task rollups are a
   status-display concern only.
3. **Two-phase hook check (hot-path discipline).** Pre-stdout: one
   synchronous read of a tiny precomputed state file (same cost class
   as `readSessionIntent`, `apps/cli/src/hooks/intent-run.ts`).
   Post-stdout: a deferred refresh folds the events ledger, evaluates
   thresholds + variance, and rewrites the state file — placed where
   `maybeRunOverlayGc` runs (`apps/cli/src/hooks/saver-run.ts`, after
   `process.stdout.write`). `mega hooks install` is untouched.
4. **Warn dedupe by announced-flags** in the state file (`warn80`,
   `warn100`, `variance`), once per session per flag. A failed
   refresh may repeat a pending line once — accepted advisory noise.
5. **Variance rule:** alarm iff same-label sample count ≥ 3 and
   `burn ≥ 3 × medianOf(historicalBurns)`. Samples are approximated
   as any OTHER labeled session with ≥ 1 measured event — the store
   has no "completed" marker, so in-flight siblings may contribute
   partial burns that deflate the median and fire the alarm early
   (accepted advisory noise, same class as Locked #4). `medianOf` =
   exact middle, mean-of-two-middles on even length. Constants
   exported, tested with fixed fixtures.
6. **Store layout:** `<root>/stats/<workspaceKey>/budget/budgets.json`
   (one atomic file: budgets + labels map) and
   `.../budget/state-<liveSessionId>.json` (per-session check state).
   `workspaceKey` from `encodeWorkspaceKey(cwd)` (`@megasaver/shared`);
   `liveSessionId` must pass `isSafeSegment`
   (`packages/stats/src/safe-segment.ts`) before becoming a filename.
7. **§3c boundary:** new code lives in `@megasaver/stats` (allowed
   deps: shared + output-filter types only — all satisfied); apps/cli
   consumes it ONLY through the `packages/core/src/context-gate.ts`
   re-export block (the `readBudget`/`readOverlayEvents` precedent).
8. **Corrupt ≠ absent.** `tokenBudgetsStatus` returns
   `absent | ok | corrupt` (the `budgetStatus` precedent). CLI reports
   corrupt with exit 1; the hook treats corrupt as absent (fail-open).

## Architecture

```
mega budget set ──writes──▶ stats/<wk>/budget/budgets.json
PostToolUse saver hook (existing) runSaverHookFromProcess:
    ├─ buildSaverDecision (unchanged)
    ├─ maybeReadBudgetWarning        sync, reads state-<sid>.json only
    ├─ stdout: renderSaverStdout(decision, warning?) ─ additionalContext
    ├─ await maybeRunOverlayGc (existing)
    └─ refreshBudgetState            deferred sync: fold readOverlayEvents,
                                     evaluateBudget + variance median,
                                     atomic rewrite state-<sid>.json
mega budget status ──reads──▶ budgets.json + events fold + proxy log
```

## Components

1. **`packages/stats/src/token-budget.ts`** — `storedTokenBudgetsSchema`
   (v1, `.strict()`): `{ version: 1, sessionDefault?, sessions{},
   tasks{}, labels{} }`, labels ≤ 64 chars; path/read/status/write
   (atomic `atomicWriteFile`)/clear helpers plus
   `effectiveSessionBudget` (precedence per Locked #2).
2. **`packages/stats/src/token-budget-burn.ts`** — pure math:
   `foldMeasuredBurn(events)`, `medianOf(values)`,
   `evaluateBudget(input): { lines, announced }` with constants
   `BUDGET_WARN_RATIO = 0.8`, `BUDGET_VARIANCE_MULTIPLE = 3`,
   `BUDGET_VARIANCE_MIN_SAMPLES = 3`. No I/O, no clock.
3. **`packages/stats/src/token-budget-state.ts`** —
   `tokenBudgetStateSchema` (burn totals, coverage counts, announced
   flags, `pendingLines` ≤ 8, `updatedAt`); read (null on any
   failure) / atomic write (tmp+rename, 0700 dir / 0600 file — the
   `writeIntentAt` posture).
4. **Core re-exports** — one export block appended to
   `packages/core/src/context-gate.ts`.
5. **`apps/cli/src/hooks/budget-run.ts`** —
   `maybeReadBudgetWarning(storeRoot, workspaceKey, liveSessionId):
   string | undefined` (synchronous by type — returns no Promise) and
   `refreshBudgetState(...): void` (deferred sync, fire-and-forget —
   Locked #3's zero-awaited-I/O discipline; never throws; enumerates
   same-label sibling sessions from `labels`, folds each via
   `readOverlayEvents`, capped at the 20 most recent).
6. **`renderSaverStdout(decision, additionalContext?)`**
   (`apps/cli/src/hooks/saver-run.ts`) — adds `additionalContext` to
   the PostToolUse envelope; a passthrough with a warning emits an
   envelope carrying ONLY `additionalContext`; passthrough without
   one stays `""` (existing contract preserved byte-for-byte).
7. **`apps/cli/src/commands/budget.ts`** — Citty group
   (`set`/`status`/`clear`) registered in `apps/cli/src/main.ts`;
   handler-function pattern with injected `stdout`/`stderr` (the
   `runBudgetSet` / `runSessionSaverStats` shape). Status also prints
   store-wide proxy receipt totals via `readProxyUsage`
   (`@megasaver/llm-proxy`; import precedent
   `apps/cli/src/commands/audit/usage.ts`), labeled
   "store-wide, not session-scoped (F33)".

## Error handling

- Every hook-side failure (missing/corrupt/unsafe-segment/EACCES) →
  `undefined`/no-op; the tool call is NEVER blocked and the envelope
  degrades to today's exact output (§13.4 fail-open, mirrors
  `runSaverHookFromProcess`'s outer catch).
- The refresh reads events with `readOverlayEvents`' tolerant parser
  (bad lines skipped) and MUST NOT call the self-healing overlay
  summary readers (`readOverlaySummary` can WRITE on read — the C1
  clobber lesson, `wiki/entities/stats.md`).
- CLI: corrupt budgets.json → exit 1 with the file path and a
  `mega budget clear` hint (the `runBudgetShow` corrupt message shape).

## Security & privacy

- No prompt or output content persisted — counts, labels, flags only.
  Task labels are user-chosen JSON map keys, never path segments.
- Path safety: `workspaceKey` is schema-validated 16-hex;
  `liveSessionId` gated by `isSafeSegment` before interpolation
  (intent-run `SAFE_SEGMENT` posture). Files 0600, dirs 0700.
- The additionalContext warning contains numbers and the task label
  only — no store paths beyond what saver footers already expose.

## Testing

- Store roundtrip / absent-vs-corrupt / schema-reject tests mirror
  `packages/stats/test/budget.test.ts` (mkdtemp fixture, no mocks).
- `medianOf` / `foldMeasuredBurn` / `evaluateBudget`: fixed-fixture
  tables (odd/even medians, unmeasured mixes, edges at exactly
  80%/100%, variance at 2 vs 3 samples, 2.9x vs 3x). No
  timing-dependent assertions anywhere (CI-slowness lesson).
- Hook: `maybeReadBudgetWarning` sync contract + fail-open matrix;
  `refreshBudgetState` announced-dedupe across two rounds on a real
  temp store with injected clock; `renderSaverStdout` envelope
  variants extend `apps/cli/test/hooks/saver-run.test.ts`.
- Hot-path guard: child-process `moduleLoadList` test mimicking
  `packages/output-filter/test/no-eager-typescript.test.ts` — the
  stats entry must load zero `node_modules/typescript` modules.
- Smoke evidence (DoD #5): captured terminal session — set a 1000
  token budget, compress twice, show the 80%/100% warnings and the
  `mega budget status` table.

## Risk & process

HIGH (§12): hook hot path + public CLI flags + store schema. Full
chain + `architect` design pass + worktree (no `main` edits);
reviewers `code-reviewer` AND `critic` (separate passes);
evidence-preserving mode only. Escalation trigger: any need to
touch `buildSaverDecision` logic, the daemon `/excerpt` schema, or a
PreToolUse deny → stop, re-scope.

## Dependencies / build order

Build order 5 of 11 (next-wave batch). Depends only on shipped
surfaces: overlay events ledger (F4), measured token fields, saver
hook path, core §3c re-export site. No new packages, no daemon
changes, no hook installs. Changeset required (stats/core/cli, DoD #9).

## Open questions

1. ASSUMPTION: Claude Code honors `hookSpecificOutput.additionalContext`
   on PostToolUse (in-repo precedents: PreToolUse `guard-run.ts`,
   UserPromptSubmit `task-kickoff.ts`). Verify with a live hook run;
   if unsupported, v1 ships the state ledger + `mega budget status`
   and the warning moves to the next UserPromptSubmit injection.
2. Free or Pro? Proposal: free (safety surface; differentiates from
   the Pro savings goal per the v1.13 decision). User call at review.
3. Fold `TaskKickoffEvent.tokenCount` (kickoff injections) into burn?
   Proposed v2 — a real receipt, but it widens Locked #1's blast
   radius in v1.
