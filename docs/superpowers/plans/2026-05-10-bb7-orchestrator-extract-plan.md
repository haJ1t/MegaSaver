---
title: BB7 — context-gate orchestrator extraction (plan)
status: proposed
risk: HIGH
created: 2026-05-10
updated: 2026-05-10
spec: ../specs/2026-05-10-bb7-orchestrator-extract-design.md
parent: ../specs/2026-05-10-aa1-context-gate-epic.md
sub-pr: BB7-orchestrator-extract
---

# BB7 — context-gate orchestrator extraction (plan)

Behaviour-preserving refactor. The CLI output pipeline moves into
`packages/core/src/context-gate/`; the CLI commands become thin
adapters. The existing `apps/cli/test/output/*` suite is the
characterization harness and MUST stay green at every step.

**Strategy:** copy-into-core first, point adapters at core, then
delete the now-orphaned CLI files. Run `apps/cli/test/output` after
each step; never let it go red. TDD applies to the NEW core unit
tests (write them against the moved functions, watch them pass).

---

## §0 Pre-flight (verify the harness is green before touching anything)

- [ ] Run `pnpm --filter @megasaver/cli test` — record the
      baseline: `file.test.ts`, `filter.test.ts`, `chunk.test.ts`,
      `locate-chunk-set.test.ts`, `no-child-process.test.ts` all
      green. → verify: green baseline captured as evidence.
- [ ] Run `pnpm --filter @megasaver/core test` — green baseline.
- [ ] `wc -l apps/cli/src/commands/output/*.ts` — record starting
      LOC for before/after comparison.

---

## §1 Core package wiring (deps + barrel scaffold)

- [ ] Add to `packages/core/package.json` `dependencies`:
      `@megasaver/policy`, `@megasaver/output-filter`,
      `@megasaver/content-store` (all `workspace:*`).
      `@megasaver/shared` already present. → verify: `pnpm install`
      resolves; `pnpm --filter @megasaver/core typecheck` still
      green (no new code yet).
- [ ] Create empty `packages/core/src/context-gate/` dir and a
      placeholder `context-gate.ts` barrel (filled in §3). → verify:
      no-op, typecheck green.

---

## §2 Move the read pipeline into core (`read.ts` + `types.ts`)

- [ ] Create `packages/core/src/context-gate/types.ts`: move
      `EffectiveSettings`, `GateResult`, `PipelineEnv` from CLI
      `shared.ts` verbatim (only import paths change — upstream
      packages imported directly, not via CLI). → verify: typecheck.
- [ ] Create `packages/core/src/context-gate/read.ts`: move
      `resolveEffectiveSettings`, `runTwoGates`, `readAndFilter`,
      `persistChunkSet`, `defaultNow`, `defaultNewId` verbatim.
      Preserve the two-gate ORDER (policy `evaluatePathRead` →
      output-filter `resolveSafeReadPath`) and the no-read-on-deny
      invariant exactly. → verify: typecheck; no `child_process`.
- [ ] Add `packages/core/test/context-gate/read.test.ts` (NEW unit
      tests, TDD): `resolveEffectiveSettings` returns defaults for
      pre-AA sessions (`tokenSaver` undefined → `mode "balanced"`,
      `storeRawOutput true`) and null for missing session/project;
      `runTwoGates` returns `path_denied` for a `.env` path,
      `path_unsafe` for `../` escape, and `ok` for an in-sandbox
      path — gate A short-circuits gate B (no read attempted).
      → verify: these tests pass against the moved code.

---

## §3 Move locate + fetch + run into core

- [ ] Move `locate-chunk-set.ts` → `packages/core/src/context-gate/locate-chunk-set.ts`
      verbatim (only the `@megasaver/shared` import path stays the
      same). → verify: typecheck.
- [ ] Create `packages/core/src/context-gate/fetch-chunk.ts`:
      compose `locateChunkSet` → `loadChunkSet` → `chunks.find` and
      return the `FetchChunkResult` discriminated union from spec
      §3c. Map `ContentStoreError("not_found")` →
      `chunk_set_not_found`, other `ContentStoreError` →
      `store_corrupt`, missing chunk → `chunk_not_found`. This is
      the `chunk.ts` body minus CLI rendering / syntactic id
      validation. → verify: typecheck.
- [ ] Create `packages/core/src/context-gate/run.ts`:
      `runOutputPipeline({ registry, storeRoot, sessionId, path,
      intent, now, newId })` composing `resolveEffectiveSettings →
      runTwoGates → readAndFilter → (storeRawOutput?) persistChunkSet`
      and returning `RunOutputResult` (spec §3c). The orchestrator
      sets `result.chunkSetId` when a chunk-set is persisted, exactly
      as `file.ts`/`filter.ts` do today. → verify: typecheck;
      no `child_process`.
- [ ] Write `packages/core/src/context-gate.ts` barrel (spec §3b,
      ≤20 LOC) and append `export * from "./context-gate.js";` to
      `packages/core/src/index.ts`. → verify: `pnpm --filter
      @megasaver/core typecheck` green.

---

## §4 Core unit tests for orchestrator + fetch (TDD against moved code)

- [ ] `packages/core/test/context-gate/run.test.ts`: drive
      `runOutputPipeline` against an in-memory / temp-dir store
      (mirror `apps/cli/test/output/file.test.ts` seed shape).
      Cover: happy path persists a chunk-set and returns
      `chunkSetId`; `storeRawOutput:false` returns ok with no
      `chunkSetId` and no file; pre-AA session uses defaults;
      `session_not_found`; `path_denied`; `path_unsafe`;
      `file_read_failed`. Pin `now`/`newId`. → verify: pass.
- [ ] `packages/core/test/context-gate/fetch-chunk.test.ts`: seed a
      stored chunk-set; assert `ok` chunk return, `chunk_not_found`,
      `chunk_set_not_found`, and `store_corrupt` on malformed JSON.
      → verify: pass.
- [ ] Re-home `apps/cli/test/output/locate-chunk-set.test.ts` →
      `packages/core/test/context-gate/locate-chunk-set.test.ts`,
      import from the core barrel, assertions UNCHANGED. Delete the
      CLI copy. → verify: pass at new location.

---

## §5 Convert CLI commands to thin adapters

- [ ] `apps/cli/src/commands/output/file.ts`: keep `runOutputFile`
      + `RunOutputFileInput` exported names. Replace the inline
      pipeline (steps after `ensureStoreReady`) with a call to
      `runOutputPipeline(...)`; `switch (result.reason)` → existing
      `errors.ts` helpers; on `ok` render the existing text/JSON
      line. Keep store-path Zod, sessionId parse, `intent_required`
      in the adapter. → verify: `file.test.ts` green, no edits.
- [ ] `apps/cli/src/commands/output/filter.ts`: same, sourcing
      `path` from `--file` (keep `file_required`). → verify:
      `filter.test.ts` green, no edits.
- [ ] `apps/cli/src/commands/output/chunk.ts`: keep
      `runOutputChunk` + input type. Keep `invalidChunkSetIdMessage`
      / `invalidChunkIdMessage` syntactic guards and store-path Zod
      in the adapter; replace locate+load+find with `fetchChunk(...)`;
      `switch (result.reason)` → existing `errors.ts` helpers; on
      `ok` render existing text/JSON. → verify: `chunk.test.ts`
      green, no edits.
- [ ] Delete `apps/cli/src/commands/output/shared.ts` and
      `apps/cli/src/commands/output/locate-chunk-set.ts`. Update
      `apps/cli/src/commands/output/index.ts` import paths only if
      needed (it imports the command objects, not shared). → verify:
      `pnpm --filter @megasaver/cli typecheck` green; full
      `apps/cli/test/output` suite green; `no-child-process.test.ts`
      still green (output sources still spawn nothing).

---

## §6 Cycle guardrail test

- [ ] Add `packages/core/test/context-gate/dependency-direction.test.ts`
      (spec §5): parse `packages/core/package.json` `dependencies`,
      assert the context-gate deps are exactly the allowed set
      (`@megasaver/shared`, `@megasaver/policy`,
      `@megasaver/output-filter`, `@megasaver/content-store`) and
      that core lists neither `@megasaver/mcp-bridge` nor any
      `apps/*`. → verify: pass.

---

## §7 Verify, evidence, audit (DoD per epic §9)

- [ ] `pnpm verify` (lint + typecheck + test) green across the
      workspace. → verify: capture full output as evidence.
- [ ] Confirm `apps/cli/test/output/*` assertions are unchanged vs
      §0 baseline (git diff shows only import-path / re-home moves,
      zero assertion edits). → verify: `git diff` on the test files.
- [ ] `wc -l packages/core/src/context-gate/*.ts` — record total
      LOC into the verifier evidence bundle for the epic §2a
      deferred-extraction audit (>500 → flag BB12 extraction;
      ≤500 → keep folded). → verify: number recorded.
- [ ] Add a changeset (core public API gained the context-gate
      surface; epic §9 item 9).
- [ ] External `code-reviewer`/`critic` pass in a separate context
      (author ≠ reviewer, `CLAUDE.md §9`). → verify: review pass.
- [ ] Zero pending TodoWrite items. Conventional commit, subject
      ≤50 chars, trailer
      `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File map (net change)

**New (core):**
- `packages/core/src/context-gate/types.ts`
- `packages/core/src/context-gate/read.ts`
- `packages/core/src/context-gate/locate-chunk-set.ts`
- `packages/core/src/context-gate/fetch-chunk.ts`
- `packages/core/src/context-gate/run.ts`
- `packages/core/src/context-gate.ts` (barrel)
- `packages/core/test/context-gate/read.test.ts`
- `packages/core/test/context-gate/run.test.ts`
- `packages/core/test/context-gate/fetch-chunk.test.ts`
- `packages/core/test/context-gate/locate-chunk-set.test.ts` (re-homed)
- `packages/core/test/context-gate/dependency-direction.test.ts`

**Edited:**
- `packages/core/src/index.ts` (append barrel re-export)
- `packages/core/package.json` (+3 workspace deps)
- `apps/cli/src/commands/output/file.ts` (thin adapter)
- `apps/cli/src/commands/output/filter.ts` (thin adapter)
- `apps/cli/src/commands/output/chunk.ts` (thin adapter)
- `apps/cli/src/commands/output/index.ts` (import paths if needed)

**Deleted:**
- `apps/cli/src/commands/output/shared.ts`
- `apps/cli/src/commands/output/locate-chunk-set.ts`
- `apps/cli/test/output/locate-chunk-set.test.ts` (re-homed to core)

**Unchanged (characterization harness — assertions frozen):**
- `apps/cli/test/output/file.test.ts`
- `apps/cli/test/output/filter.test.ts`
- `apps/cli/test/output/chunk.test.ts`
- `apps/cli/test/output/no-child-process.test.ts`
