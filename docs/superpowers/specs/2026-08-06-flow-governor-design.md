---
feature: flow-governor
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "6 of 20 (wave-2 batch)"
---

# Flow Governor (A2/A3 + loop half of proposal 7)

## Problem

Session flow anomalies burn turns, and turns are the multiplier on the
whole bill (`wiki/syntheses/cache-write-cost-reduction-2026-08-01.md`
§1): a session that dithers past its task's normal turn count keeps
paying full-prefix cache writes (§3 A2), and the same tool+args call
repeated in a tight loop is the classic runaway — infinite loops are
18% of harness bugs (`wiki/syntheses/llm-code-problems-research-2026-07.md`
proposal 7). Mega Saver already logs every eligible tool call
(PreToolUse telemetry, `apps/cli/src/hooks/logger.ts` →
`.megasaver/hooks/claude-tool-calls.jsonl`) but nothing reads that
log mid-session to nudge the agent back on course.

## Goal

Advisory-only session-flow nudges over the existing telemetry:

1. **TURN-BUDGET (A2):** when a session's logged tool-call count
   crosses 1.5× the trailing median of same-task-label sibling
   sessions, inject ONE consolidation nudge ("batch your open
   questions").
2. **LOOP (proposal 7, loop half):** when the same tool+filePath
   signature recurs ≥ 3× inside a 5-minute window, inject ONE
   "stop and diagnose" nudge.
3. One bounded advisory channel (the budget-circuit-breaker's
   PostToolUse `additionalContext` seam), at-most-once per session
   per detector, every detector independently opt-outable, all
   fail-open — worst failure is silence, never a blocked call.

## Non-Goals

- Blocking, denying, or rewriting any tool call. Advisory text only.
- Re-implementing BATCH-READ (A3): it SHIPPED as the batch-read
  advice hook (`apps/cli/src/hooks/cache-advice-run.ts`, plans
  2026-08-01/2026-08-02, opt-out `mega hooks install
  --no-cache-advice`). Flow Governor documents it as its third
  detector and touches none of its code.
- The token-budget half of proposal 7 — OWNED by
  `docs/superpowers/specs/2026-08-06-budget-circuit-breaker-design.md`;
  we consume its channel design and duplicate nothing.
- Capturing anything new in the PreToolUse log (no command bodies,
  no arg hashes — v1 works from existing fields only).
- Turn ≠ API turn claims: we report "logged tool calls", never
  pretend to count model round-trips.
- Daemon routes, GUI surface, log rotation, ML/heuristics beyond the
  fixed thresholds below.

## Locked Decisions

1. **Data source = existing telemetry, nothing new captured.** Both
   detectors fold `<cwd>/.megasaver/hooks/claude-tool-calls.jsonl`
   (`HOOK_LOG_RELATIVE_PATH`, `apps/cli/src/hooks/logger.ts`), whose
   lines carry exactly `{timestamp, agent, tool, category,
   filePath?, sessionId?}`. Reads are tail-bounded (last 256 KB) with
   the tolerant per-line parse posture of `ingestHookLog`
   (`packages/stats/src/metrics.ts`). No log installed → detectors
   inert (fail-open).
2. **"Turn" = logged eligible tool-call line.** Honest proxy; nudge
   copy says "tool calls". Lines without `sessionId` are excluded
   from per-session folds.
3. **Task labels come from the budget store.** Cohort binding reuses
   `labels{}` in the budget-circuit-breaker's `budgets.json`
   (its Locked #6). No label for the live session → TURN-BUDGET
   inert. Trailing median = `medianOf` (its Component 2) over sibling
   sessions visible in the log tail; fire iff siblings ≥ 3, live
   calls ≥ 10, and live ≥ 1.5 × median. Constants exported,
   fixed-fixture tested.
4. **Loop signature = `tool + "\0" + filePath`.** Only lines carrying
   `filePath` participate — Bash bodies are never logged (§13.4
   metadata-only), so Bash loops are out of v1 scope (Open Q2). Fire
   iff one signature recurs ≥ 3× within the trailing 5 minutes of
   the live session; pick the highest-count (then most-recent) group.
5. **Channel = the budget breaker's, verbatim.** Two-phase hook
   discipline (its Locked #3): pre-stdout ONE synchronous read of a
   tiny per-session state file; post-stdout a deferred refresh that
   folds the log, evaluates detectors, and atomically rewrites state.
   Delivery rides `renderSaverStdout(decision, additionalContext?)`
   (its Component 6); the saver hook joins budget warning + flow
   nudge lines with `"\n"`. We inherit its Claude-Code-acceptance
   ASSUMPTION unchanged (its Open Q1) — see Open Q1 below.
6. **At-most-once per session per detector.** State file
   `stats/<wk>/flow/state-<sid>.json`: `announced` flags set at
   detection time, `pendingLines` (≤ 2, each ≤ 400 chars) delivered
   on the NEXT hook invocation then cleared by that invocation's
   refresh. A failed refresh may repeat a pending line once —
   accepted advisory noise (parity with budget Locked #4).
   Read-modify-write is guarded by `withFileLock`
   (`@megasaver/shared/node`); a lock miss skips the refresh.
7. **Opt-out per detector, silence on corrupt settings.**
   `stats/<wk>/flow/settings.json` `{version: 1, disabled:
   FlowDetector[]}` written by `mega flow enable|disable
   <detector>`. Absent → both on (advisory default). Corrupt → both
   OFF: for a nuisance-control surface the safe failure is silence,
   not noise. BATCH-READ opt-out stays where it lives
   (`--no-cache-advice`); `mega flow status` points at it.
8. **§3c boundary.** Pure math + stores in `@megasaver/stats`
   (allowed deps satisfied); apps/cli consumes ONLY via the
   `packages/core/src/context-gate.ts` re-export block (the
   `readBudget` precedent — apps/cli never imports stats directly).
9. **Redact everything echoed.** Nudge copy passes through `redact`
   (`@megasaver/policy`, the `captureIntent` precedent) — task
   labels and file paths are user-controlled strings; paths are
   truncated to 120 chars before rendering.

## Architecture

```
PreToolUse logger (shipped) ──appends──▶ <cwd>/.megasaver/hooks/claude-tool-calls.jsonl
mega budget set --task … (breaker) ────▶ stats/<wk>/budget/budgets.json (labels)
PostToolUse saver hook runSaverHookFromProcess:
    ├─ maybeReadBudgetWarning (breaker)      sync
    ├─ maybeReadFlowNudge                    sync, reads flow/state-<sid>.json
    ├─ stdout: renderSaverStdout(decision, join(warning, nudge))
    ├─ await maybeRunOverlayGc (existing)
    └─ refreshFlowState        post-stdout: log tail ≤256KB → parseFlowLog →
                               evaluateTurnBudget + detectLoop → redact →
                               withFileLock + atomic rewrite state-<sid>.json
mega flow status|enable|disable ──▶ stats/<wk>/flow/settings.json
```

## Components

1. **`packages/stats/src/flow-metrics.ts`** — pure, no I/O, no clock:
   `parseFlowLog(content)` (tolerant), `evaluateTurnBudget({lines,
   liveSessionId, labels})`, `detectLoop({lines, liveSessionId,
   nowMs})`; constants `FLOW_TURN_MULTIPLE = 1.5`,
   `FLOW_TURN_MIN_SIBLINGS = 3`, `FLOW_TURN_MIN_LIVE_CALLS = 10`,
   `FLOW_LOOP_MIN_REPEATS = 3`, `FLOW_LOOP_WINDOW_MS = 300_000`,
   `FLOW_LOG_TAIL_BYTES = 262_144`. Imports `medianOf` from
   `./token-budget-burn.js` (breaker Component 2).
2. **`packages/stats/src/flow-store.ts`** — `FLOW_DETECTORS =
   ["turn-budget", "loop"]`, settings schema/read/write (Locked #7
   corrupt→off), per-session state schema/read/write
   (`atomicWriteFile`, 0700/0600); `liveSessionId` gated by
   `isSafeSegment` (`packages/stats/src/safe-segment.ts`) before
   becoming a filename.
3. **Core re-exports** — one block appended to
   `packages/core/src/context-gate.ts`.
4. **`apps/cli/src/hooks/flow-run.ts`** — `maybeReadFlowNudge(payload,
   storeRoot): string | undefined` (synchronous by type) and
   `refreshFlowState({payload, storeRoot, now?}): void` (deferred,
   never throws; parses `{session_id, cwd}` itself so it does not
   depend on breaker internals; log path =
   `join(cwd, HOOK_LOG_RELATIVE_PATH)`); renders + redacts nudge copy.
5. **Saver hook wiring** — `runSaverHookFromProcess`
   (`apps/cli/src/hooks/saver-run.ts`) composes the two advisory
   strings into the single `additionalContext` argument; refresh
   call placed after `process.stdout.write` beside the breaker's.
6. **`apps/cli/src/commands/flow.ts`** — Citty group
   (`status`/`enable`/`disable`, positional detector), registered in
   `apps/cli/src/main.ts`; cli-test-pattern handler shape
   (`wiki/workflows/cli-test-pattern.md`).

## Error handling

- Every hook-side failure (log missing, unparseable lines, corrupt
  state, lock miss, EACCES, unsafe session id) → `undefined`/no-op;
  hooks always exit 0 and the envelope degrades to today's bytes
  (§13.4, mirrors `runSaverHookFromProcess`'s outer catch).
- Truncated first line of a tail read is skipped by the tolerant
  parser, never an error.
- CLI: corrupt settings.json → exit 1 with path + `mega flow enable`
  hint; the hook side treats the same file as all-off (Locked #7).

## Security & privacy

- Nothing new persisted about the user's work: state holds flags,
  counts, and ≤ 2 pre-redacted advisory strings only.
- Echoed label/path go through `redact` and length caps (Locked #9);
  the log itself already contains no contents or command bodies.
- Path safety: `workspaceKey` schema-validated; session id via
  `isSafeSegment`; dirs 0700, files 0600, atomic tmp+rename writes.

## Testing

- `flow-metrics`: fixed-fixture JSONL tables — threshold edges
  (median 10 vs live 14/15/16, 2 vs 3 siblings, unlabeled live
  session), loop at 2× vs 3×, window edge via fixture timestamps
  (injected `nowMs`; no timing-tight assertions — CI-slowness
  lesson), missing-`sessionId`/missing-`filePath` exclusions,
  malformed lines skipped.
- `flow-store`: mkdtemp roundtrip, absent/corrupt matrices
  (settings corrupt → all-off), safe-segment rejection.
- Hook: `maybeReadFlowNudge` sync contract + fail-open matrix;
  refresh announced-dedupe across two rounds on a real temp store;
  composition cases extend `apps/cli/test/hooks/saver-run.test.ts`;
  redaction of a secret-bearing path in the loop nudge.
- CLI: cli-test-pattern for status/enable/disable.
- Smoke evidence (DoD #5): captured terminal session — seeded log +
  labels, one compress, both nudges appear once and never again.

## Risk & process

MEDIUM (§12): advisory-only, no store schema changes to existing
files, no new capture, hook additions are one sync read + post-stdout
work. Full superpowers chain; reviewer `code-reviewer`; worktree.
Escalation to HIGH if implementation must touch `buildSaverDecision`,
the logger's captured fields, or any PreToolUse deny path.

## Dependencies / build order

Build order 6 of 20 (wave-2 batch). Hard dependency:
budget-circuit-breaker (order 5) for `renderSaverStdout`'s
`additionalContext` parameter, `medianOf`, and the `labels{}` map —
consume, never re-implement; if its tasks have not landed, implement
those two seams exactly per its plan first. Soft dependency: hooks
installed (`mega hooks install claude-code`) for the telemetry log.
Changeset required (stats/core/cli, DoD #9).

## Open questions

1. Inherited ASSUMPTION (breaker Open Q1): Claude Code honors
   `hookSpecificOutput.additionalContext` on PostToolUse. Same
   fallback: state + `mega flow status` ship; nudges move to the
   next UserPromptSubmit injection if a live run disproves it.
2. Bash loops: invisible without arg capture. Add an optional
   `argsHash` (sha256 of canonical `tool_input`, still
   metadata-only) to the logger in v2? Needs a logger-spec
   amendment — user call.
3. Default-on for both detectors (proposed) or opt-in? Advisory
   surfaces argue default-on; user call at review.
4. Sessions without a task label never get TURN-BUDGET nudges
   (Locked #3). Acceptable for v1, or should kickoff task inference
   feed labels later?
