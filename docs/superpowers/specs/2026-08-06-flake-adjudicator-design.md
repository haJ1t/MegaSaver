---
feature: flake-adjudicator
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "13 of 20 (wave-2 batch)"
---

# Flake Adjudicator

## Problem

When a test command run through `mega output exec` fails, neither the
human nor the agent knows WHICH kind of failure it is. The human ritual
is "just re-run it"; the agent burns ~20k tokens root-causing a ghost.
This repo fights the exact class itself: two tests failed only under
`turbo test --force` across all 60 tasks — never in isolation — and
were made honest by hand (`wiki/log.md` entry `[2026-08-06] fix | two
load-sensitive tests, made honest`; commits `7469812c` "widen the
coupled window in the process-group kill race", `6d48d4a3` "guard
non-vacuity structurally, not by throughput", recorded by `33469463`).
The store already persists every run's raw output as a lossless chunk
set and (post-C3) the child exit code on the event row — but nothing
turns a failure plus targeted re-runs into an evidence-backed verdict.

## Goal

When an allowlisted test command fails under `mega output exec`,
synchronously re-run ONLY the failed test (name-filtered, N times,
hard wall-clock budget) and stamp a verdict into the returned digest:
`real` (0/N isolation passes), `flaky` (k/N, with the diverging runs'
receipts), `load-sensitive` (N/N — failed in suite, passes in
isolation), or `unadjudicated` (budget or extraction limits — honest,
never guessed). All raw re-run output → lossless chunk sets; the agent
sees verdict + first-failure excerpt + fetch handles; the verdict is
recomputable from persisted receipts alone.

## Non-Goals (YAGNI)

- No overlay/hook-path adjudication (`runOverlayOutputExecCommand`,
  PostToolUse saver). v1 is the registry exec path only; a hook must
  stay fail-open-fast, not spend a 60 s budget.
- No background/async re-runs, no queue. Synchronous inside the exec
  call, bounded by the budget.
- No cross-run flake history or quarantine list (future feature).
- No re-running non-allowlisted commands, ever — the allowlist ships
  EMPTY and is the only trigger (non-idempotent safety).
- No new exit-code persistence: `childExitCode` (claim-verification
  gate C3, `2026-08-06-claim-verification-gate-design.md` Decision 1)
  is the ONLY exit-code field, on every run's event row.
- No wildcard/glob allowlist patterns in v1 (token-prefix only).
- No adjudication of multi-failure runs beyond the first failure.

## Locked Decisions

1. **Opt-in token-prefix allowlist, ships empty.** Entry = literal
   command tokens (`"pnpm test"`), matched by `===` prefix against
   `[command, ...args]`. No globs, no regex from user input — the
   dumbest matcher guards the non-idempotent gate (the repo already
   dropped user-input regexes once: [[concepts/glob-compile-redos]]).
   `mega flake enable <pattern> [--runs N] [--budget-sec S]` /
   `disable` / `status`. Stored at `<storeRoot>/flake/allowlist.json`,
   Zod-validated at the read boundary.
2. **Trigger + eligibility.** Inside `runOutputExecCommand` only,
   after capture: allowlist prefix-match AND `childExitCode` non-zero
   AND not `null` (a bound-killed run has partial output — no honest
   parse, no re-run) AND `--no-flake` not passed. Anything else: zero
   extra spawns, result byte-identical to today.
3. **Re-run = same command + framework NAME-FILTER args.** Never file
   targets (positional targets union on pytest/vitest; name filters
   narrow on all four): vitest `-t <name>` (+ file positional),
   pytest `-k <name>`, go `-run ^<escaped>$` (per `/`-segment),
   cargo positional `<name>` filter. For `npm|pnpm|yarn|bun` script
   runners a `--` separator is inserted when absent. Every re-run is
   re-gated through `evaluateCommand` before spawn (tighten-only,
   defense in depth) and reuses `runChild` — same timeout/max-bytes/
   kill-grace machinery (`packages/context-gate/src/run-command.ts:119`).
4. **Hard wall-clock budget.** Default `DEFAULT_FLAKE_BUDGET_MS =
   60_000`, per-entry `--budget-sec` (5..600). Injectable
   `nowMs?: () => number` clock (tests never sleep). Per-run
   `timeoutMs = min(remaining, exec timeoutMs)`; below 1 000 ms
   remaining, stop. Fewer completed runs than planned → verdict
   `unadjudicated`, reason `budget`. Never guessed.
5. **Verdict semantics (closed enums, order pinned).**
   `flakeVerdictSchema = ["real","flaky","load-sensitive",
   "unadjudicated"]`; reasons `["budget","no-failed-test-id",
   "multi-failure","rerun-failed"]`. passes 0/N → `real`; 0<k<N →
   `flaky`; N/N → `load-sensitive` — exactly the failed-in-suite +
   passed-in-isolation class the wiki documents (`wiki/log.md`
   `[2026-08-06] fix | two load-sensitive tests, made honest`).
   More than 3 distinct extracted failures → `multi-failure` (likely
   real breakage; don't burn budget). Both enums get `test-d.ts`
   tuple-ordering pins (AA1 §17 precedent,
   `apps/cli/test/enum-pin-audit.test.ts`), append-only.
6. **Evidence: receipts are event rows + chunk sets.** Each re-run
   appends its own event with NEW `sourceKind: "flake-rerun"` —
   appended LAST to `outputSourceKindSchema` (`packages/output-filter/
   src/output-source.ts:3`; ordering pin `output-source.test-d.ts`
   updated, existing members untouched) so C3's `verify claims`
   (which filters `sourceKind === "command"`) can never count an
   isolation pass as a suite receipt. Re-run events carry
   `childExitCode` (C3 field, reused — Non-Goal 5), zero savings
   fields (`returnedBytes`/`bytesSaved`/`deltaBytes`/`savingRatio` =
   0 — no fabricated saving, honest-metrics rule [[entities/stats]]),
   redacted re-run label, and `chunkSetId` when `storeRawOutput`.
   Three additive-optional fields on BOTH event schemas (precedent:
   `deltaBytes`, `rawTokens`, `childExitCode` in
   `packages/stats/src/event.ts`): `adjudicationId` (suite event +
   re-runs share it), `rerunIndex`, `rerunPlanned`. Recompute =
   group by `adjudicationId`, count `childExitCode === 0`, compare
   count of rerun rows against `rerunPlanned`.
7. **Digest stamp.** `ExecResult` gains optional `flake:
   FlakeAdjudication` — verdict, k/N, framework, redacted test id,
   redacted first-failure excerpt (≤ 400 chars), `adjudicationId`,
   per-run receipts `{ runIndex, exitCode, eventId, chunkSetId? }`.
   CLI prints one verdict line + fetch handles; `--json` and the MCP
   envelope carry the field as-is (its bytes count into
   `mcpEnvelopeBytes` — the verdict pays for itself honestly).
8. **Failed-test extraction lives in `@megasaver/output-filter`.**
   New `parsers/failed-tests.ts`: `extractFailedTests(raw)` reuses
   the shipped detectors in detection order `pytest → cargo → go →
   vitest` (mirrors `parsers/index.ts:37-55`; `detectPytest`,
   `detectCargoTest`, `detectGoTest`, `detectTestOutput`). Row
   regexes are per-split-line and anchored WITHOUT `/m` — sidesteps
   the `^`-under-`m` U+2028 rescan trap the parser headers document
   ([[concepts/unbounded-run-redos]]); every quantifier bounded.

## Architecture

```
mega output exec <sid> -- pnpm test        (allowlisted, exit != 0)
  -> runOutputExecCommand: capture suite run (runChild)
  -> extractFailedTests(raw)          (@megasaver/output-filter)
  -> adjudicateFailure                (context-gate src/flake/)
       loop i < runs, budget via nowMs:
         evaluateCommand(rerun) -> runChild(rerun, min(remaining, timeout))
         -> saveChunkSet (lossless raw)      [storeRawOutput]
         -> appendEvent { sourceKind:"flake-rerun", childExitCode,
                          adjudicationId, rerunIndex, rerunPlanned }
  -> computeFlakeVerdict(passes, completed, planned)
  -> ExecResult.flake stamped; suite event carries adjudicationId
CLI/MCP render verdict + excerpt + chunk fetch handles
```

## Components

1. **`output-filter/src/parsers/failed-tests.ts`** —
   `testFrameworkSchema` (order = detection order: `["pytest",
   "cargo-test","go-test","vitest"]`), `FailedTestRef = { framework,
   file?, name?, raw }`, `extractFailedTests`. Public via `index.ts`.
2. **`context-gate/src/flake/allowlist.ts`** — Zod schema
   `{ version: 1, entries: [{ pattern, runs, budgetMs, addedAt }] }`;
   `readFlakeAllowlist` (absent file → empty; malformed → typed
   error), `upsertFlakeEntry` / `removeFlakeEntry` via `withFileLock`
   (`@megasaver/shared/node`, `{ deadlineMs: 50, staleMs: 5000 }`)
   around the package's named atomic writer
   `writeFlakeAllowlistAtomic` (tmp + rename);
   `matchFlakeEntry(entries, command, args)` token-prefix.
3. **`context-gate/src/flake/rerun-args.ts`** — `buildRerunArgs`
   (Decision 3, pure), `escapeGoRunPattern`.
4. **`context-gate/src/flake/verdict.ts`** — `flakeVerdictSchema`,
   `unadjudicatedReasonSchema`, `computeFlakeVerdict` (pure),
   `recomputeVerdictFromEvents` (pure — the Decision 6 recompute).
5. **`context-gate/src/flake/adjudicate.ts`** — the orchestrator
   loop; consumed by `run-command.ts`; injectables `spawn`, `nowMs`,
   `now`, `newId`.
6. **Wiring** — `run-command.ts` eligibility gate + suite-event
   `adjudicationId`; `ExecResult.flake`. New exports through
   `packages/core/src/context-gate.ts` (apps/cli imports core only —
   `apps/cli/test/dependency-graph.test.ts` pin).
7. **CLI** — `apps/cli/src/commands/flake.ts` (`mega flake
   enable|disable|status`, [[workflows/cli-test-pattern]] shape),
   registered in `main.ts`; `--no-flake` flag + verdict rendering in
   `commands/output/exec.ts`.

## Error handling

- Adjudication never breaks the primary result: extraction failure →
  `unadjudicated`/`no-failed-test-id`; re-run spawn error or policy
  denial → `unadjudicated`/`rerun-failed` (+ non-fatal warning, the
  `captureWarnings` pattern of `run-command.ts:299`); chunk/event
  write failure on a re-run → warning, receipt list holds only what
  persisted. No throw reaches the exec caller.
- Malformed allowlist file → adjudication disabled for the run +
  warning (fail-inert, not fail-open: a broken config must never
  cause a spawn).
- CLI failure paths: text → stderr, empty stdout, exit 1; new helpers
  in `apps/cli/src/errors.ts` (`flakePatternRequiredMessage`,
  `invalidFlakeRunsMessage`, `invalidFlakeBudgetMessage`).

## Security & privacy

- Never re-run off-allowlist; every re-run passes `evaluateCommand`
  again; allowlist file validated with Zod at the boundary (§8).
- Re-run labels and the echoed excerpt/test id go through `redact`
  (`packages/policy/src/redact.ts:44`) before persist/echo — same
  discipline as the suite label (`run-command.ts:290`).
- Re-run chunk sets follow the primary path byte-for-byte
  (`recoverableChunks`, redacted `source`); no new raw surface.
- Budget + runs bounds cap resource use; `MEGASAVER_ORIGIN_PID`
  recursion guard is inherited from `runChild` unchanged.

## Testing (TDD — red first; detail in plan)

| Layer | Test |
|-------|------|
| output-filter | per-framework extraction fixtures; multi-failure count; non-test output → `[]`; bounded-regex line discipline |
| allowlist | absent/valid/malformed reads; prefix-match table; lock + atomic write (concurrent enable keeps valid JSON) |
| rerun-args | 4 frameworks; pm `--` insertion; go escaping |
| verdict | k/N table incl. budget-short recompute; enum order pins (`test-d.ts`) |
| adjudicate (fake spawn) | real/flaky/load-sensitive event + chunk trails; budget cut via stepped `nowMs`; denial → `rerun-failed`; NO spawn beyond suite when: allowlist empty, exit 0, `--no-flake`, terminated |
| CLI | enable/disable/status via `Command.run?.({...} as never)` + temp stores; exec verdict line + `--json` |

Fake-spawn precedent verified: `makeChild`/`spawnMock` in
`packages/context-gate/test/ledger-signed-delta.test.ts:61-83` — the
adjudicator tests extend it to a scripted spawn sequence. No
timing-tight assertions anywhere (the lesson of `7469812c`).

## Risk & process

HIGH (§12: connector-core exec path, child-process spawning, public
CLI flags). Full chain + `architect` design pass + worktree (no
`main` edits). Reviewers: `code-reviewer` AND `critic`, separate
passes, never the authoring context. Evidence-preserving only: every
run's raw output is chunk-set-recoverable; verdicts recomputable.
Escalation → CRITICAL if re-runs ever mutate user files beyond the
tested command's own behavior (they must not — same command, same
cwd, narrower selection).

## Dependencies / build order

13 of 20 (wave-2). Hard dependency: claim-verification-gate (3 of 11)
must land first — `childExitCode` on both event schemas is consumed,
never duplicated (its Decision 1 / cross-pair ownership note).
Touches: output-filter (extractor + enum member), stats (3 optional
fields), context-gate (flake module + wiring), core (re-exports),
cli. Changeset required for all five (DoD #9).

## Open questions

- ASSUMPTION: vitest default reporter prints failed tests as
  `FAIL <file> > <suite> > <name>` rows; verify against a real
  vitest 3 run at impl time and widen the fixture if the tree
  (`❯`/`×`) form is the only one present.
- Cargo exact-match (`-- --exact`) vs substring filter — v1 ships
  substring; revisit if a real corpus shows over-broad re-runs.
- Wildcard allowlist patterns and overlay-path adjudication:
  deferred; each addition re-runs the safety test set.
- Flake history / quarantine ledger across sessions: future spec.
