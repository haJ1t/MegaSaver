---
title: BB7b — mega output exec + child-process spawn — TDD plan
status: proposed
risk: CRITICAL
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB7b
spec: docs/superpowers/specs/2026-05-10-bb7b-output-exec-design.md
---

# BB7b TDD plan — `mega output exec`

Execution discipline: failing tests FIRST (`CLAUDE.md` §4, §9.3),
then implementation, then `pnpm verify`, then the CRITICAL gate
(§12: `tracer` + `security-reviewer` + manual user confirmation),
then merge. Author and reviewer are NEVER the same active context
(§9.6). All work in the worktree
`/Users/halitozger/Desktop/MegaSaver/.worktrees/bb7b-output-exec`
only.

`child_process.spawn` is MOCKED in every unit test — NO real
process is spawned in CI (spec §9). Real-spawn smoke evidence is
gathered MANUALLY under §12 supervision (Phase 5), never in the
test suite.

## File map

### New source files
- [ ] `packages/core/src/context-gate/run-command.ts` —
      spawn-specialised orchestrator (`runCommand` / `execCommand`;
      exact name per the extraction PR — Phase 0). ≤300 LOC.
- [ ] `apps/cli/src/commands/output/exec.ts` — `RunOutputExecInput`,
      `runOutputExec`, `outputExecCommand` (thin adapter). ≤300 LOC.

### Edited source files
- [ ] `packages/core/src/context-gate.ts` + `packages/core/src/index.ts`
      — re-export the orchestrator on the public surface.
- [ ] `apps/cli/src/commands/output/index.ts` — register
      `exec: outputExecCommand`; re-export `runOutputExec` +
      `RunOutputExecInput` (mirror existing file/filter/chunk
      re-exports).
- [ ] `apps/cli/src/errors.ts` — add `commandDeniedMessage`,
      `commandFailedMessage`, `redactionFailedMessage`,
      `storeWriteFailedMessage` (extend; do not rewrite). Reuse
      `intentRequiredMessage`, `sessionNotFoundMessage`,
      `invalidSessionIdMessage`.
- [ ] `apps/cli/package.json` — add `@megasaver/stats`
      `workspace:*` ONLY if a stats type leaks into the adapter
      (spec §11 q4 — prefer consuming via `@megasaver/core`; leave
      deps unchanged if possible).

### New test files
- [ ] `packages/core/test/context-gate/run-command.test.ts` —
      orchestrator unit tests, `spawn` mocked.
- [ ] `apps/cli/test/output/exec.test.ts` — command coverage.
- [ ] `apps/cli/test/output/exec.recursive.test.ts` — inherited
      `MEGASAVER_ORIGIN_PID` → `recursive_megasaver`.

### Edited test files
- [ ] `apps/cli/test/json-failure-paths.test.ts` — add `output
      exec` failure cases (intent missing, command denied, session
      not found).
- [ ] `apps/cli/test/dependency-graph.test.ts` — widen allow-list
      ONLY if `apps/cli` gains a direct `@megasaver/stats` dep
      (spec §11 q4).

### Tuple pins / scaffold
- None. BB7b introduces no new package and no new closed enum
  (§17). It consumes `PolicyDenyCode`, `OutputSourceKind`,
  `TokenSaverMode`. No `*.test-d.ts`, no package scaffold.

## Phase 0 — extraction-PR contract reconciliation (BLOCKING)

Spec §11 q1–q3: the orchestrator's exported name and input record
must match `feat/bb7-orchestrator-extract`. Do NOT write the
adapter before this is pinned.

- [ ] Inspect the landed `packages/core/src/context-gate/`: confirm
      `run.ts` / `run-command.ts`, the exported function name, its
      input record, whether it accepts an injected `spawn`,
      injected `originPid` (string), injected `now`/`newId`, and
      whether it takes the session or pre-resolved
      `EffectiveSettings`.
- [ ] Confirm `contextHints` is exported (spec §11 q3). If absent,
      record that BB7b omits `sessionHints` and files a follow-up.
- [ ] Confirm `stats` exposes only `appendEvent` (no
      `updateSessionStats` — spec §11 q2). Lock single-call.
- [ ] Write `<remember>` note recording the locked contract so the
      executor and reviewer share it.

## Phase 1 — failing orchestrator tests (RED)

Write against the not-yet-existing `run-command.ts`. Inject a
mock `spawn` (a fake `ChildProcess`-like emitter), `now`, `newId`,
and `originPid`. Seed an in-memory or `mkdtemp` store with a
project + session.

- [ ] policy denial → no spawn: assert the injected `spawn` mock is
      NEVER called when `evaluateCommand` returns `allowed: false`
      (drive with a non-allowlisted command → `command_not_allowed`;
      a `rm -rf /` line → `dangerous_pattern`; inherited
      `originPid !== pid` → `recursive_megasaver`).
- [ ] spawn success: mock emits stdout + stderr chunks; assert
      combined-in-arrival-order raw → `redact` → `filterOutput`
      (`source.kind === "command"`) → `saveChunkSet` (when
      `storeRawOutput`) → `appendEvent`. Assert returned shape
      `{ summary, excerpts, chunkSetId?, rawBytes, returnedBytes,
      bytesSaved, savingRatio }`.
- [ ] redaction applied: secret-shaped stdout → stored + returned
      text redacted; `secretsRedacted` (= `redact.count`) recorded
      on the event.
- [ ] `redacted: true` invariant: session `redactSecrets: true` →
      persisted chunkSet has `redacted: true` (epic §10d / F-MAJ-3).
- [ ] `redactSecrets: false` → warning appended to
      `result.warnings`; chunkSet `redacted: false`.
- [ ] `storeRawOutput: false` → no `saveChunkSet`, no `chunkSetId`
      in result, content dir empty.
- [ ] timeout / spawn error: mock emits `error` (ENOENT) or timeout
      → orchestrator returns the `command_failed`-class result; no
      store, no stats event.
- [ ] byte-cap: mock emits > `64 * maxBytes` → capture stops at the
      cap; `rawBytes` ≤ cap; later chunks dropped.
- [ ] maxBytes resolution: `tokenSaver.maxReturnedBytes` honored;
      pre-AA session → `modeToBudget("balanced")`; persisted value
      over `64_000` clamped to `64_000` (spec §5).
- [ ] env propagation: assert the injected `spawn` receives
      `env.MEGASAVER_ORIGIN_PID === originPid`.
- [ ] redaction_failed: stub `redact` to throw → orchestrator
      returns `redaction_failed`-class result; no store.
- [ ] store_write_failed: stub `saveChunkSet` to throw →
      `store_write_failed`-class result.
- [ ] Run → expect RED (orchestrator absent).

## Phase 2 — failing CLI adapter tests (RED)

Write against the not-yet-existing `runOutputExec`. Mirror the
BB7a `output/file.test.ts` harness: `mkdtemp` store seeded with a
project + session; inject `now`/`newId`/`originPid` and a mock
`spawn` (threaded through to the orchestrator). Provide explicit
stdout/stderr collectors.

- [ ] `intent_missing`: `--intent` undefined/empty → exit 1,
      `error: intent_required …` on stderr, spawn mock NEVER called.
- [ ] `command_denied: command_not_allowed`: non-allowlisted cmd →
      exit 1, stderr `error: command_denied: command_not_allowed`,
      no spawn.
- [ ] `command_denied: dangerous_pattern`: `-- rm -rf /` → exit 1,
      stderr `error: command_denied: dangerous_pattern`, no spawn.
- [ ] `session_not_found`: unknown session id → exit 1, no spawn.
- [ ] invalid session id (Zod) → exit 1, no spawn.
- [ ] spawn success (text): mocked → exit 0, `Ran <cmd> for <id>
      (… B kept, … B saved, …%)` + `chunkSetId=` when stored.
- [ ] spawn success (`--json`): exit 0, single-line
      `{ "sessionId": "...", "result": { … } }`; `result.chunkSetId`
      present iff stored; assert it parses as JSON.
- [ ] timeout / spawn error → exit 1, stderr `error: command_failed:
      …`, no JSON on stdout.
- [ ] exit-code 2: stub the orchestrator to throw an unexpected
      error → `runOutputExec` returns 2, stderr `error: unexpected
      failure: …` (spec §6).
- [ ] `--json` failure invariant: for EVERY failure branch above,
      stdout is empty and stderr is plain text (not JSON).
- [ ] `apps/cli/test/output/exec.recursive.test.ts`: set input
      `originPid` to a value `!== String(process.pid)` (simulating
      inherited `MEGASAVER_ORIGIN_PID`) → exit 1, stderr
      `error: command_denied: recursive_megasaver`, spawn NEVER
      called.
- [ ] Extend `json-failure-paths.test.ts`: `runOutputExec` with
      intent missing, command denied, session not found — each
      asserts empty stdout, plain-text stderr, exit ≥ 1.
- [ ] Run → expect RED (adapter + command absent).

## Phase 3 — implementation (GREEN)

- [ ] `run-command.ts`: implement spec §3 steps 3b–10 against the
      Phase-0 contract. Order is load-bearing: `evaluateCommand`
      BEFORE spawn; `redact` BEFORE `saveChunkSet`; `saveChunkSet`
      BEFORE `appendEvent`. Spawn options exactly
      `{ stdio: ["ignore","pipe","pipe"], timeout: 5*60*1000,
      env: { ...process.env, MEGASAVER_ORIGIN_PID: originPid } }`.
      Combine stdout+stderr in arrival order; cap at `64 * maxBytes`.
      `spawn` is injectable (default `node:child_process.spawn`).
- [ ] Re-export the orchestrator from `context-gate.ts` +
      core `index.ts`.
- [ ] `errors.ts`: add the four message builders (spec §8).
- [ ] `exec.ts`: thin adapter — store resolve → sessionId parse →
      intent check → compute `originPid` in the `defineCommand`
      wrapper (`process.env.MEGASAVER_ORIGIN_PID || String(process.pid)`)
      → call orchestrator → map result/errors to text/JSON + exit
      `0|1|2`. NO spawn/policy/filter logic in the adapter.
- [ ] `output/index.ts`: register `exec`; re-export.
- [ ] Run `pnpm --filter @megasaver/core test context-gate` and
      `pnpm --filter @megasaver/cli test output` → drive all new
      suites GREEN. Confirm each new file ≤300 LOC.

## Phase 4 — verify (DoD §9.4)

- [ ] `pnpm verify` from the worktree root (lint + typecheck +
      test, whole monorepo). Capture honest passing output — no
      green claim without real output.
- [ ] `apps/cli/test/dependency-graph.test.ts` green (allow-list
      unchanged unless a direct `stats` dep was added — spec §11 q4).
- [ ] Confirm zero pending checkboxes in this plan.
- [ ] Changeset: REQUIRED — `@megasaver/core` public API changed
      (orchestrator re-exported). Add a changeset.

## Phase 5 — CRITICAL gate (§12, §16) — NO unsupervised completion

- [ ] `architect` design memo noted (alternatives considered) —
      precedes this plan per §16; confirm the artifact exists.
- [ ] `critic` (opus) adversarial pass AFTER implementation,
      BEFORE `code-reviewer` (separate context).
- [ ] `code-reviewer` pass (separate context, §9.6).
- [ ] `tracer` pass — enumerate every branch that could spawn a
      child or skip the policy gate; confirm the spawn-never-called
      assertions cover them.
- [ ] `security-reviewer` sign-off report as a PR comment — spawn
      path, env handling (`MEGASAVER_ORIGIN_PID` propagation),
      policy gate, redaction-before-store.
- [ ] `verifier` (`omc:verify`) evidence bundle: test output, exit
      codes, coverage diff.
- [ ] **MANUAL real-spawn smoke** (NOT in CI): run
      `mega output exec <id> --intent "failing tests" -- pnpm test`
      against a real seeded session; capture output into the
      verifier evidence bundle. Confirm a chunkSet is written with
      `redacted: true` (session `redactSecrets: true`).
- [ ] **Post-merge LOC audit** (§2a trigger): run
      `wc -l packages/core/src/context-gate/*.ts`; record total in
      the evidence bundle. If > 500 LOC, queue the BB12 chore PR to
      extract `@megasaver/context-gate`.
- [ ] **MANUAL user confirmation**: user replies `confirm BB7b
      merge` verbatim to a message linking the verifier bundle, the
      security report, and the smoke output (§16, F-MAJ-6). NO
      merge before this reply.
- [ ] NO `autopilot` / `ralph` / unsupervised loops at any point
      (§12). NO log compression (paradox guard, §15).

## Phase 6 — commit & merge

- [ ] Commit (Conventional Commits, ≤50-char subject), e.g.
      `feat(cli): add mega output exec spawn command`. Body explains
      the `recursive_megasaver` env-marker propagation invariant
      and the policy-before-spawn ordering (the non-obvious WHY).
- [ ] Merge only after the manual confirmation reply (Phase 5).

## Guardrails (Must / Must NOT)

**Must:** mock `spawn` in ALL unit tests; policy gate BEFORE spawn
(assert spawn-never-called on denial); redact BEFORE store; store
BEFORE stats; propagate `MEGASAVER_ORIGIN_PID` into the spawn ENV;
inject `spawn`/`now`/`newId`/`originPid`; extend (not rewrite)
`errors.ts` and `json-failure-paths.test.ts`; orchestrator in
`core/context-gate`, adapter thin in `apps/cli`; files ≤300 LOC;
honest `pnpm verify`; full CRITICAL chain + manual confirmation
before merge.

**Must NOT:** put spawn/policy/filter logic in `apps/cli`;
re-implement the orchestrator the extraction PR owns; spawn a real
process in CI; add a new package or closed enum; add
`stats.updateSessionStats` (does not exist — use `appendEvent`);
add defensive checks for impossible cases beyond the CRITICAL-
justified `redaction_failed`/`store_write_failed` wraps; compress
logs; merge without manual `confirm BB7b merge`.
