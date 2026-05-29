---
title: mega session saver CLI — BB2 implementation plan
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB2
spec: ../specs/2026-05-10-bb2-session-saver-design.md
---

# BB2 implementation plan (TDD)

Run all commands from
`/Users/halitozger/Desktop/MegaSaver/.worktrees/bb2-session-saver`.
Test before code (`CLAUDE.md` §4). Each test step must produce a
**failing** run before its impl step. Mirror `update.ts` exactly.

## Step 1 — Error helpers (failing tests first)

- [ ] In `apps/cli/test/session-saver.test.ts`, add a `describe` block
      for error helpers: import `invalidModeMessage`,
      `missingModeMessage`, `unexpectedModeMessage`,
      `MODE_INVALID_MESSAGE_PREFIX` from `../src/errors.js`. Assert
      `invalidModeMessage("x").message` starts with the prefix and lists
      `aggressive | balanced | safe`; assert exitCode 1 for all three.
- [ ] Run `pnpm --filter @megasaver/cli test session-saver` → FAILS
      (imports unresolved).
- [ ] Add to `apps/cli/src/errors.ts`: import `tokenSaverModeSchema`
      from `@megasaver/shared`; add `MODE_INVALID_MESSAGE_PREFIX`,
      `invalidModeMessage`, `missingModeMessage`, `unexpectedModeMessage`
      (bodies per spec §6).
- [ ] Re-run → error-helper block PASSES.
- [ ] Acceptance: helper messages match spec §6; lists mode options
      from `tokenSaverModeSchema.options`.

## Step 2 — enable + disable (failing tests first)

- [ ] In `session-saver.test.ts`, add behavior tests against a temp
      store seeded with one open session (mirror the `seedProject` +
      `mkdtemp` pattern in `json-failure-paths.test.ts`; create a
      session via `runSessionCreate` or a seeded `sessions.json`):
      enable balanced → exit 0, JSON `tokenSaver.enabled===true`,
      `mode==="balanced"`, `maxReturnedBytes===12000`; enable missing
      `--mode` → exit 1, non-JSON stderr; enable invalid mode → exit 1;
      disable after enable → `enabled===false`, `createdAt` preserved,
      `updatedAt` changed.
- [ ] Run → FAILS (run-fns don't exist).
- [ ] Create `apps/cli/src/commands/session/saver/enable.ts` and
      `disable.ts`. Each: `runSessionSaverEnable` / `...Disable` +
      `sessionSaverEnableCommand` / `...DisableCommand` via
      `defineCommand`. Follow `update.ts` run-fn order: `resolveStorePath`
      → `sessionIdSchema.parse` → mode-flag validation → `ensureStoreReady`
      → `getSession` (null → `mapErrorToCliMessage(err,{kind:"session",id})`
      after the registry op, OR pre-check) → build full settings (spec
      §4a/§4b) using injected `now` → `registry.updateTokenSaver` →
      text/JSON emit (spec §5). Inject `now: () => new Date().toISOString()`
      at the `defineCommand` boundary.
- [ ] Re-run → enable/disable blocks PASS.
- [ ] Acceptance: persisted settings match spec §4a/§4b; budget mapping
      via `modeToBudget`; full-replacement semantics correct.

## Step 3 — status + stats (failing tests first)

- [ ] Add tests: status on unconfigured session → not-configured CTA
      text + JSON `tokenSaver:null`; status on enabled session → enabled
      line; status with `--mode` → exit 1 (`unexpectedModeMessage`);
      stats on configured session → JSON `eventStats:null` + BB6
      sentence in text; stats on unconfigured → CTA.
- [ ] Run → FAILS.
- [ ] Create `status.ts` and `stats.ts` (read-only; never call
      `updateTokenSaver`). stats emits `eventStats: null` and the literal
      BB6 sentence per spec §4d/§5 — NO invented store, NO placeholder
      counters.
- [ ] Re-run → status/stats blocks PASS.
- [ ] Acceptance: read-only confirmed; spec §4c/§4d/§5 shapes exact.

## Step 4 — Wire the subcommand tree

- [ ] Create `apps/cli/src/commands/session/saver/index.ts`: re-export
      the four run-fns + commands; define `sessionSaverCommand =
      defineCommand({ meta:{name:"saver",...}, subCommands:{ enable,
      disable, status, stats } })`.
- [ ] Modify `apps/cli/src/commands/session/index.ts`: import
      `sessionSaverCommand`, add `saver: sessionSaverCommand` to
      `sessionCommand.subCommands`, add the re-export block (mirror the
      existing `update` export block).
- [ ] Add a test asserting `mega session saver --help` lists all four
      subcommands (or assert `sessionCommand.subCommands.saver` is
      defined with the 4 keys).
- [ ] Run `pnpm --filter @megasaver/cli test session-saver` → PASS.
- [ ] Acceptance: subcommands reachable; barrel exports only public surface.

## Step 5 — Extend json-failure-paths drift guard

- [ ] In `apps/cli/test/json-failure-paths.test.ts`, import
      `runSessionSaverEnable` / `runSessionSaverDisable`. Add three
      `describe` blocks using the existing `seedProject` + `nonJsonStderr`
      helpers: (a) enable invalid `--mode` → exit 1, empty stdout,
      `nonJsonStderr`; (b) enable missing `--mode` → exit 1; (c) disable
      nonexistent session → exit 1.
- [ ] Run `pnpm --filter @megasaver/cli test json-failure-paths` → PASS.
- [ ] Acceptance: every saver write command participates in the JSON
      drift guard (spec §5b / epic §5a `--json` parity rule).

## Step 6 — Verify

- [ ] `pnpm --filter @megasaver/cli test` → all green.
- [ ] `pnpm lint:fix` then `pnpm verify` (lint + typecheck + test) → green.
- [ ] Manual smoke (optional, temp store): `enable`, `status`, `stats`,
      `disable` against a seeded session; confirm text + `--json` lines.
- [ ] Acceptance: spec §9 fully satisfied; no exit-2 path; no
      half-implemented stats store.

## Step 7 — Commit & handoff

- [ ] Stage only BB2 files (file map, spec §8). Conventional Commit,
      subject ≤ 50 chars: `feat(cli): add mega session saver subcommands`.
- [ ] Do NOT merge: §9 DoD requires external `code-reviewer`/`critic`
      pass (author != reviewer) + verifier evidence before "done".
- [ ] No changeset needed unless CLI public API is tracked by changesets
      (confirm against repo `.changeset` convention before adding).

## Guardrails

- Must have: full-replacement `updateTokenSaver`; injected `now`;
  `--mode` required-on-enable / rejected-elsewhere; honest
  `eventStats:null` for stats; JSON only on success.
- Must NOT: create any stats/content store (that is BB6); add path
  read / child spawn (BB7); touch other worktrees; add comments without
  a WHY; introduce an exit-2 path; hardcode `Date.now()` at module level.
