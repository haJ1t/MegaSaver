---
feature: claim-verification-gate
date: 2026-08-06
risk: MEDIUM
status: approved
pending: []
reviewers: [code-reviewer]
build-order: "3 of 11 (next-wave batch)"
approved: 2026-08-14
freshness: |
  Reconciled against main @ 5dcab305 (2026-08-14): all anchors present
  (line drift only: run-command.ts event literals now :441/:682,
  hook-settings event union :338, SessionStart pair :427/:435,
  buildHookCommand :40, cli main.ts subCommands :75; writeSettingsFile
  lives in settings-write.js). overlayTokenSaverEventSchema gained the
  exec-rewrite `origin` field (additive — no conflict). Cross-batch
  contracts intact: no network I/O in hook paths; this pair owns the
  additive `childExitCode` field; review-packs consumes.
---

# Claim-Verification Gate (C3)
## Problem

"Tests pass" without a receipt is the top trust failure in agentic
coding (wiki/syntheses/vibe-coding-pains-2026.md P4). The operator's
own delegation rule states it directly: a worker's claim is not a
passing test. The store ALREADY captures the evidence — every
`mega output exec` / `proxy_run_command` run persists a
`TokenSaverEvent` with `sourceKind: "command"`, a redacted command
`label`, `createdAt`, and `chunkSetId`
(`packages/context-gate/src/run-command.ts:433`, `:679`;
`packages/stats/src/event.ts`) — but the event does NOT carry the
child's exit code, and nothing joins success claims against these
rows. Evidence exists; the gate that checks a claim against it does
not.

## Goal
1. Make exec receipts complete: record the child exit code on the
   existing event rows.
2. `mega verify claims [--session <id>]` — scan caller-provided text
   for success-claim patterns and join them against receipts in a
   time window; table + `--json` report.
3. Optional, off-by-default Stop-hook reminder when a live session
   has no recent exec receipt (`mega verify enable-hook`).

## Non-Goals (YAGNI)

- NO automatic transcript scraping of agent internals. v1 input is
  explicit: piped text or `--file <path>` (treated as plain text; no
  transcript-format parsing).
- No claim-category ↔ receipt-command semantic matching (a "tests
  pass" claim is not matched only against test commands).
- No judgement of code quality. The gate reports evidence presence
  and exit codes — honest-metrics rule ([[entities/stats]]).
- No blocking: the Stop hook never emits `decision: "block"`.
- No overlay-session support in `verify claims` v1 (registry
  sessions only; the hook covers the live/overlay side). No
  persistence of claims or reports — the only new stored datum is
  one integer field on the existing event row.

## Locked Decisions

1. **Receipt = existing `TokenSaverEvent` row, completed.** Add
   additive-optional `childExitCode: z.number().int().nullable()
   .optional()` to `tokenSaverEventSchema` AND
   `overlayTokenSaverEventSchema` (`packages/stats/src/event.ts`).
   Both schemas are `.strict()`; optional fields keep pre-C3 rows
   parsing (precedent: `deltaBytes`, `rawTokens` in the same file).
   Semantics mirror capture (`run-command.ts:196`): `null` =
   bound-killed child (timeout/max_bytes), absent = pre-C3 row =
   unrecorded. Writers: `runOutputExecCommand` and
   `runOverlayOutputExecCommand` only.
2. **Claim regex list locked, linear-time.** Six patterns (ids:
   `tests-pass`, `all-green`, `build-succeeds`, `suite-green`,
   `verify-green`, `lint-clean`; exact source in the plan, Task 2).
   Every quantifier is bounded (`[ \t]{1,3}` gaps, fixed-word
   alternations) — no unbounded run before a required literal
   ([[concepts/unbounded-run-redos]]). Input capped at
   `MAX_CLAIMS_INPUT_BYTES = 8_388_608` (the shipped cap the ReDoS
   guard sizes against, [[concepts/redos-guard-testing]]).
3. **Window anchors at invocation time.** v1 claims carry no
   timestamps (explicit input), so a receipt is in-window when
   `now - createdAt <= windowMinutes` (default 30, `--window`
   1..1440). Newest in-window receipt wins the join; all considered
   receipts appear in `--json`.
4. **Verdicts are a closed 4-member union:** `verified` (exit 0),
   `exit-mismatch` (non-zero or terminated), `exit-unrecorded`
   (pre-C3 receipt), `no-receipt`. Default exit code 0 (report-only);
   `--strict` exits 1 if any verdict is `no-receipt` or
   `exit-mismatch` (CI gate). `--session` omitted → detection-only
   report, no verdicts; combining it with `--strict` is a usage
   error (`strictRequiresSessionMessage`, exit 1) — a strict gate
   that can produce no verdicts must not trivially pass.
5. **Hook trigger is receipt-presence, not claim detection.**
   Detecting "the last claim-like output" requires reading the
   transcript — forbidden by Non-Goal 1. v1 reminds when the live
   session recorded zero in-window `sourceKind: "command"` receipts
   (`readOverlayEvents` keyed by `encodeWorkspaceKey(cwd)` +
   `session_id`, same parity as the intent hook,
   [[concepts/intent-aware-hook]]). Warn-only, fail-open, always
   exit 0, off by default; `mega verify enable-hook` opts in.

## Architecture

```
mega output exec / proxy_run_command
  -> runOutputExecCommand / runOverlayOutputExecCommand
  -> TokenSaverEvent { sourceKind:"command", label, createdAt,
                       chunkSetId?, childExitCode? (NEW) }

mega verify claims --session <id> [--file p | stdin]
  -> scanClaims(text)                      (locked patterns)
  -> readEvents via @megasaver/core        (§3c: never stats direct)
  -> receiptsFromEvents -> joinClaimsToReceipts(window)
  -> table / --json; --strict -> exit 1 on missing evidence

Stop hook (opt-in): mega hooks verify-reminder
  -> readOverlayEvents(wk, session_id) -> no in-window receipt?
  -> additionalContext reminder (warn-only) ; else silent
```

## Components

1. **Receipt field** — schema + two writer literals (above). No
   reader changes; `appendEvent` validates through the same schema.
2. **`claim-patterns.ts`** (`apps/cli/src/commands/verify/`) —
   `CLAIM_PATTERNS`, `scanClaims(text): DetectedClaim[]`
   (`{ patternId, excerpt, index }`, excerpt ≤ 80 chars,
   whitespace-normalized).
3. **`receipts.ts`** — `receiptsFromEvents(events): VerificationReceipt[]`;
   `VerificationReceipt = { command /*label, pre-redacted*/, exit:
   {kind:"code";code}|{kind:"terminated"}|{kind:"unrecorded"},
   recordedAt, sessionId, chunkSetId? }`.
4. **`join.ts`** — `joinClaimsToReceipts({claims, receipts, now,
   windowMinutes}): JoinResult` where `JoinResult = { rows:
   VerifiedClaim[]; considered: VerificationReceipt[] }` (pure;
   verdict per Decision 4; `considered` is what carries Decision 3's
   "all considered receipts appear in `--json`" requirement — a bare
   `VerifiedClaim[]` cannot).
5. **`claims.ts`** — `runVerifyClaims` + `verifyClaimsCommand`
   (citty, [[workflows/cli-test-pattern]] shape); new top-level
   `verify` group in `apps/cli/src/main.ts`.
6. **Stop hook** — `"Stop"` added to the hook-settings event union
   (`packages/connectors/claude-code/src/hook-settings.ts:324`) with
   `hasStopHook`/`addStopHook` mirroring the SessionStart pair
   (`:413`/`:421`, no matcher); handler
   `apps/cli/src/hooks/verify-reminder-run.ts` + command
   `mega hooks verify-reminder`; `mega verify enable-hook` /
   `disable-hook` write the entry (atomic, command-level strip on
   uninstall — PR #141 discipline).

## Error handling

- CLI failure paths follow the JSON policy: text → stderr, empty
  stdout, exit 1. New helpers in `apps/cli/src/errors.ts`:
  `claimsInputRequiredMessage`, `claimsInputTooLargeMessage`,
  `invalidWindowMessage`, `strictRequiresSessionMessage`
  (Decision 4). Session/store errors reuse
  `mapErrorToCliMessage` / `sessionNotFoundMessage`.
- Stats readers already skip malformed JSONL lines; a pre-C3 row is
  a valid receipt with `exit: unrecorded` — never a crash.
- Hook: any error (missing payload, unreadable store, malformed
  events) → print nothing, exit 0 (mirrors `intent-run.ts`).

## Security & privacy

- Receipt `command` is the event `label`, redacted at the source
  before persist (`run-command.ts` redacts command + args
  element-wise) — the gate never re-reads raw chunks.
- Claim excerpts are echoed only to the invoking terminal; nothing
  from the scanned text is persisted.
- Reminder copy is fixed and content-free (no command, path, or
  session detail beyond what the hook was handed).
- ReDoS discipline per Decision 2; growth-ratio guard mandatory
  ([[concepts/redos-growth-ratio-measurement]]).

## Testing (TDD — red first; detail in plan)

| Layer | Test |
|-------|------|
| stats schema | `childExitCode` 0 / null / absent parse; non-int rejected |
| context-gate | fake-spawn exec close(0)/close(2) → event carries the code (both writers) |
| scanClaims | per-pattern positives, `\b` negatives (`password`, `tests fail`), excerpt cap, ordering |
| ReDoS guard | non-vacuity (min match count) + n-vs-4n growth ratio (min-per-size, threshold 8, calibrated repeats, explicit timeout) + revert proven red |
| receipts/join | mapping table; window edges; newest-wins; all 4 verdicts |
| CLI | table + `--json` shapes, `--strict` exit, failure paths (no input, too large, bad window, unknown session) |
| hook | receipt present → silent; absent → reminder JSON; malformed payload → exit 0 silent |

## Risk & process

MEDIUM (§12): normal feature, no core-path behavior change (one
additive field + a read-only reporter + a warn-only hook). Required
reviewer: `code-reviewer`. Worktree default (§4). Escalation
triggers → HIGH: claim scanning ever runs inside a hook hot path
against unbounded transcript input; any event field becomes
non-optional or rewritten; hook gains blocking power.

## Dependencies / build order

Build order 3 of 11 (next-wave batch). Depends only on shipped
surfaces: stats event schemas, context-gate exec orchestrators, core
re-exports (§3c), connector-claude-code hook-settings. No new
packages, no new deps. Changeset required (DoD #9: stats,
context-gate, connector-claude-code, cli).

Cross-pair ownership: this pair owns the additive-optional
`childExitCode` field on `tokenSaverEventSchema` /
`overlayTokenSaverEventSchema` written at the run-command seams
(`packages/context-gate/src/run-command.ts`). review-packs
(build-order 8) consumes childExitCode receipt rows; it adds no
ledger of its own.

## Open questions

- ASSUMPTION: Claude Code accepts `hookSpecificOutput.additionalContext`
  on Stop-hook stdout; if it does not, fall back to `systemMessage`
  (warn-only either way). Verify against hooks docs at impl time.
- ASSUMPTION: the Stop payload carries `cwd` (SessionStart/
  UserPromptSubmit do); fallback `process.cwd()` — Claude Code runs
  hook commands in the project directory.
- Overlay receipts in `verify claims` (`--live <workspace>`)?
  Deferred — needs a workspace-selection UX. Pattern-list growth
  ("lgtm", "ship it") is additive; every addition re-runs the ReDoS
  guard suite.
