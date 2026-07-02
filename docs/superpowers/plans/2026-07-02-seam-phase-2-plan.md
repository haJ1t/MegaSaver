# Seam Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD every task: failing test → red for the right reason → minimal impl → green → commit. `pnpm verify` at every task boundary. Vitest resolves `@megasaver/*` via built dist — run `pnpm build` after src edits.

**Goal:** Extend the live context seam to read/overlay paths, add memory/conventions hint sources, cut capture noise, and make seam effectiveness measurable.

**Spec:** `docs/superpowers/specs/2026-07-02-seam-phase-2-design.md`
**Branch:** `feat/seam-phase-2` (stacked on `feat/core-live-context-seam`).
**Risk:** MEDIUM-HIGH → reviewer per task + critic before PR.

**Execution order:** P2.5 → P2.4 → P2.1 → P2.2 → P2.3 → P2.6 (small/independent first; overlay store before its consumers; measurement last since it instruments the wired call sites).

---

## Task P2.5 — FILE_PATH signature allowlist

**Files:** `packages/context-gate/src/session-hints.ts`, `packages/context-gate/test/session-hints.test.ts`

- Failing tests first: `README.md`, `example.com`, `a.b` → no signature; `src/auth.ts:42` → `src/auth.ts:42` + `src/auth.ts`; `config.yml` → signature.
- Impl: after a FILE_PATH regex match, keep the token only if its extension (lowercased, pre-`:line`) is in `CODE_EXTENSIONS` set: `ts tsx js jsx mjs cjs py go rs java rb c h cpp hpp cs swift kt json yml yaml toml sql sh`. ERROR_CODE path untouched.
- Check existing tests asserting old over-match behavior; update only those assertions.
- Run: `pnpm --filter @megasaver/context-gate test -- session-hints`, then commit `fix(context-gate): restrict failure signatures to code extensions`.

## Task P2.4 — benign-exit capture filter (registry path)

**Files:** `packages/context-gate/src/run-command.ts` (capture block ~:263), `packages/context-gate/test/session-failure-capture.test.ts`

- Failing tests first (mirror existing capture-test harness): exit 1 + empty redacted output → **no** record; exit 1 + output → record; exit 3 + empty → record (terminated path unaffected).
- Impl: compute redacted output once (it's already computed for `errorOutput`); skip the `createSessionFailure` call when `childExitCode === 1 && terminated === undefined && redactedOutput.trim() === ''`. WHY comment: grep/diff/test no-match convention.
- NOTE: the existing core-side integration test "empty output … records one SessionFailure with errorOutput ''" (packages/core/test/context-gate/run-command.test.ts) asserts exit-3-style semantics — check its exit code; if it uses exit 1 + empty it now contradicts the spec and must be updated to exit 3 (spec wins; state this in the commit body).
- Commit `fix(context-gate): skip capture for evidence-free exit-1`.

## Task P2.1 — read-path hints

**Files:** `packages/context-gate/src/read.ts` (`filterRaw` ~:156), `packages/context-gate/src/run.ts` (`runOutputPipeline` ~:72, filterRaw call ~:113), tests in `packages/context-gate/test/`

- `filterRaw` input gains optional `sessionHints` (mirror how `outline` threads at :162) and forwards it + `engineRanking: true` to `filterOutput` (:164) **only when hints provided** (bare `filterRaw` callers unchanged → no behavior change for them).
- `runOutputPipeline`: `const sessionHints = buildSessionHints(input.registry, settings.projectId, input.sessionId)` after settings resolve, pass to `filterRaw`. Registry port already has `listSessionFailures`.
- Integration test: failing command (records failure with `src/auth.ts` signature) → subsequent `runOutputPipeline` read of a file whose content mentions `src/auth.ts` + noise → boosted chunk outranks noise (`engine.failureHistoryBoost > 0`). Confirm RED by running pipeline before wiring.
- Watch: `runOverlayOutputPipeline` (:192) untouched this task.
- Commit `feat(context-gate): failure-aware ranking on registry reads`.

## Task P2.2 — overlay failure store + capture + hints

**Files:** new `packages/context-gate/src/overlay-failures.ts` (+ export), `packages/context-gate/src/run-command.ts` (overlay exec ~:390–512), `packages/context-gate/src/run.ts` (overlay read ~:192), tests

- Store: `failures/<workspaceKey>/<liveSessionId>.jsonl` under `storeRoot`; validate segments exactly like `content-store/src/paths.ts:33` (`assertSafeSegment` — copy the pattern, or import if exported). API: `appendOverlayFailure(storeRoot, workspaceKey, liveSessionId, record)`, `readOverlayFailures(...): OverlayFailureRecord[]`. Record: `{command, errorOutput, source: 'proxy-classifier', createdAt}` (both text fields redacted by caller, 4000 cap). Trim on append: keep newest `MAX_OVERLAY_FAILURES = 50` (read→append→slice(-50)→rewrite; single atomic write like json-directory-store's pattern).
- Capture in `runOverlayOutputExecCommand`: same trigger + benign filter + redaction as registry path; best-effort try/catch → warning channel (mirror the registry path's `captureWarnings`).
- Hints: `buildOverlayHints(storeRoot, workspaceKey, liveSessionId)` → `{recentFailures: signatures}` via the same `extractFailureSignatures`; pass + `engineRanking: true` into the overlay `filterOutput` calls (`run-command.ts:426`, and the overlay read pipeline's filter call in `run.ts`).
- Tests: unit (append/trim-to-50/read; unsafe segment rejected), integration (overlay exec fails with `TS2322 src/x.ts` evidence → next overlay exec output mentioning it outranks noise), capture-benign (exit 1 empty → no append).
- Commit `feat(context-gate): overlay failure capture + failure-aware ranking`.

## Task P2.3 — memory + conventions hints

**Files:** `packages/context-gate/src/session-hints.ts`, `packages/context-gate/src/registry-port.ts`, `packages/context-gate/src/run-command.ts` + `run.ts` (no change if builder signature stable), tests

- Registry port widens with narrow read methods — check the REAL `CoreRegistry` for the right ones (likely `listMemoryEntries(projectId)` and `listProjectRules(projectId)`; use whatever exists — do NOT add core methods unless truly absent).
- `buildSessionHints` additionally returns:
  - `recentMemory`: for recallable+approved+non-stale entries (reuse `isRecallable` from core if exported; else filter on `approval==='approved' && !stale`) → flatten `relatedFiles` + `relatedSymbols`, dedup, cap 12. **Never** `keywords`/`content`/`title`.
  - `projectConventions`: flatten `ProjectRule.appliesTo`, dedup, cap 12.
- Tests: memory with `relatedFiles:['src/auth.ts']` → hints include it and a later chunk mentioning `src/auth.ts` gets `memoryBoost > 0`; memory with only keywords → contributes nothing (this is the non-tautology mutation target: switching impl to keywords must fail it); unapproved/stale memory excluded; rules' `appliesTo` lands in `projectConventions`.
- Perf note: builder now does up to 3 registry reads per call — acceptable (JSONL reads); do NOT add caching this task.
- Commit `feat(context-gate): memory + conventions hint sources`.

## Task P2.6 — seam measurement (`mega audit seam`) + A/B switch

**Files:** `packages/output-filter/src/rank.ts` (env resolver), `packages/output-filter/src/replay-trace.ts` (reader), `packages/context-gate/src/run-command.ts` + `run.ts` (recordTrace + write), `apps/cli/src/commands/audit/seam.ts` (new, register beside `audit/report.ts`), tests in each

1. **A/B**: add `engineRankingDisabledByEnv()` to rank.ts (true iff `MEGASAVER_ENGINE_RANKING` is explicitly `false`, trimmed/lowercased). The three registry-path seam call sites pass `engineRanking: !engineRankingDisabledByEnv()` instead of literal `true`. Test: env `false` → `engine` absent from excerpts; unset/other → present.
2. **Record**: at `runOutputExecCommand` + `runOutputPipeline`, set `recordTrace: true` in the filterOutput input; if `result.trace` present, append via existing `writeReplayTrace` to `store.root/stats/<projectId>/<sessionId>.traces.jsonl` — confirm `writeReplayTrace(dir)` semantics (it appends `<dir>/replay-traces.jsonl`; if the filename is fixed, pass a per-session dir `stats/<projectId>/<sessionId>-traces/` instead — follow the real function, adjust the plan detail, keep it best-effort).
3. **Reader**: `readReplayTraces(path): ReplayTrace[]` (JSONL parse, skip bad lines) in replay-trace.ts, exported.
4. **CLI**: `mega audit seam [--project …] [--session …]` mirrors `audit/report.ts` wiring: resolve store → locate trace files → aggregate: traces total, engineRanking-on count, failure-boost fire rate (% traces with any chunk `engine.failureHistoryBoost > 0`), memory-boost fire rate, mean fired boost, rawTokens/returnedTokens sums. Plain text output like existing audit commands. Register the subcommand where `audit report`/`audit usage` are registered.
5. Tests: reader unit (good+corrupt lines); CLI test with fixture traces (mirror existing audit command tests in `apps/cli/test/`); integration: seam-on session produces a trace whose fire rate `audit seam` reports non-zero.
- Commit `feat(cli): mega audit seam — seam effectiveness report` (+ separate commits per package if cleaner).

---

## Final gate (before PR)

- `pnpm verify` green; conventions:check green.
- Changeset: minor for `@megasaver/context-gate`, `@megasaver/output-filter`, `@megasaver/cli` (+ content-store if the overlay store lands there).
- code-reviewer + critic (fresh contexts) over the whole phase-2 diff; verifier evidence pass.
- PR stacked: base `feat/core-live-context-seam`.

## Deferred

`recentFiles` (hashed read-index), overlay memory hints, overlay traces, TTL pruning, fractionMatched changes.
