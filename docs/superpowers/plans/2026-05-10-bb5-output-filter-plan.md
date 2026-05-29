---
title: BB5 — @megasaver/output-filter TDD plan
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB5
spec: docs/superpowers/specs/2026-05-10-bb5-output-filter-design.md
---

# BB5 — `@megasaver/output-filter` TDD plan

Worktree (work ONLY here):
`/Users/halitozger/Desktop/MegaSaver/.worktrees/bb5-output-filter`

Method: failing-tests-first per stage, then implementation, then
`pnpm verify`, then commit. Spec
`docs/superpowers/specs/2026-05-10-bb5-output-filter-design.md`
is authoritative for every locked surface. HIGH risk →
`security-reviewer` audit before merge (epic §12/§14).

## Phase 0 — Scaffold the package (mirror `packages/shared/`)

- [ ] Create `packages/output-filter/` with config files copied
      from `packages/shared/`, changing ONLY package identity and
      the dependency block (spec §4): `package.json`,
      `tsconfig.json`, `tsconfig.test.json`, `tsconfig.test-d.json`,
      `tsup.config.ts`, `vitest.config.ts`.
- [ ] `package.json` deps = `@megasaver/policy: workspace:*`,
      `@megasaver/shared: workspace:*`, `zod: ^3.24.1`; devDeps =
      `@types/node ^22.19.17`, `fast-check ^3.23.2`.
- [ ] Create empty `src/index.ts` placeholder barrel.
- [ ] DO NOT edit `pnpm-workspace.yaml` (already globs `packages/*`).
- [ ] Run `pnpm install` in the worktree root so `workspace:*`
      links resolve.
      Verify: install exits 0; `packages/output-filter/node_modules`
      contains symlinks to `@megasaver/policy` and `@megasaver/shared`.

## Phase 1 — Cycle guardrail (§3c) — RED then GREEN

- [ ] Write `test/dependency-graph.test.ts` mirroring
      `packages/policy/test/dependency-graph.test.ts`:
      `ALLOWED_DEPENDENCIES = ["@megasaver/policy","@megasaver/shared","zod"]`;
      subset assertion; NOT `@megasaver/core`; exact-set equality.
      Verify (RED→GREEN): the test passes immediately because
      Phase 0 wrote the correct deps. (This test is the guard, not
      a TDD driver — it must be green from the first run and stay
      green.)

## Phase 2 — Closed enums + tuple pins — RED first

- [ ] Write `test/output-source.test-d.ts` and
      `test/rank-features.test-d.ts` mirroring
      `packages/shared/test/token-saver-mode.test-d.ts`
      (member-assignability, `@ts-expect-error` non-member ×2,
      `.options` spread, exact readonly-tuple pin per spec §7.1/§7.2).
      Write `test/error-code.test-d.ts` for
      `outputFilterErrorCodeSchema` (`["path_unsafe","validation_failed"]`).
      Verify (RED): `pnpm --filter @megasaver/output-filter test`
      fails to compile (modules absent).
- [ ] Implement `src/output-source.ts`, `src/rank-features.ts`,
      `src/errors.ts` exactly per spec §7–§8 (alphabetic enums).
      Verify (GREEN): the three `*.test-d.ts` files pass; tuple
      order locked.

## Phase 3 — Pure stage modules — RED then GREEN per stage

Each stage: write the unit test first (RED), then the module
(GREEN). Stages stay pure (no IO).

- [ ] `test/normalize.test.ts` → `src/normalize.ts` (spec §6
      stages 2–3): ANSI strip, `\r\n`/`\r`→`\n`, per-line trailing
      trim, consecutive-duplicate collapse → `… [repeated N times]`
      for `N>=2`.
- [ ] `test/chunk.test.ts` → `src/chunk.ts`: `chunkByLines(40)`
      boundary behaviour (40-line groups, final partial group,
      empty input).
- [ ] `test/parsers.test.ts` → `src/parsers/{test-output,
      ts-diagnostic,stacktrace}.ts` + `src/parsers/index.ts`:
      each parser recognises its format; dispatch precedence is
      first-match; no-match falls back to line chunking. Pin
      detection signatures against fixtures here.
- [ ] `test/rank.test.ts` → `src/rank.ts` (spec §6 stage 5):
      `scoreChunk(intent, chunk, sessionHints)` returns a
      `RankFeatures` record keyed by every `RankFeatureName`;
      error/diagnostic/stacktrace chunks outscore noise;
      `duplicatePenalty`/`noisePenalty` subtract (positive
      magnitudes).
- [ ] `test/dedupe.test.ts` → `src/simhash.ts` + `src/dedupe.ts`:
      64-bit simhash + hamming distance; near-duplicate chunks
      within `HAMMING_DEDUPE_THRESHOLD = 3` are dropped, distinct
      chunks kept. Confirm/tune threshold against fixtures;
      document final value in `dedupe.ts`.
- [ ] `test/fit.test.ts` → `src/fit.ts` (spec §6 stage 7 + §6.1):
      greedy descending-score pick until next chunk would exceed
      `effectiveBudget`; UTF-8 byte length via `Buffer.byteLength`;
      `maxReturnedBytes` above `HARD_CEILING_BYTES = 64_000` is
      clamped (not rejected).
- [ ] `test/summarize.test.ts` → `src/summarize.ts` (spec §6
      stage 8): deterministic, NO LLM; `safe`→medium,
      `balanced`→short, `aggressive`→tiny; reports chunk
      kept/dropped counts and top error line.

## Phase 4 — `filterOutput` orchestration — RED then GREEN

- [ ] `test/filter-output.test.ts` (RED): boundary parse via
      `filterOutputInputSchema` (`.strict()` rejects unknown keys,
      throws `OutputFilterError("validation_failed")`); 9-stage
      order; large multi-KB blob → `savingRatio > 0`,
      `returnedBytes <= effectiveBudget`; error lines surface in
      `excerpts` ahead of noise; repeated lines collapsed;
      `rawBytes===0` → `savingRatio===0`; `warnings` carries the
      redaction count when `count>0`; `chunkSetId` stays undefined
      (BB5 never persists).
- [ ] Implement `src/types.ts` exporting `filterOutput`,
      `filterOutputInputSchema`, `FilterOutputInput`,
      `FilterOutputResult`, `OutputExcerpt`; wire stages 1–9.
      Stage 1 imports `redact` from `@megasaver/policy`; budget
      uses `modeToBudget` from `@megasaver/shared`.
      Verify (GREEN): `filter-output.test.ts` passes.

## Phase 5 — Redaction pipeline invariant (F-MED-1) — RED then GREEN

These verify the PIPELINE invariant (no secret survives
`filterOutput`), NOT policy internals (spec §3.1).

- [ ] `test/redact-pipeline.property.test.ts` (fast-check):
      generate inputs embedding each §9d secret shape at random
      positions inside larger noise; assert no recognised secret
      substring survives `filterOutput(...).summary` +
      `excerpts[].text`.
- [ ] `test/fixtures/redaction/<name>/{input.txt,expected-absent.txt}`
      seed: one per §9d pattern name + three negatives (prose
      "bearer", too-short `sk-`, credential-less
      `mongodb://localhost`).
- [ ] `test/redact-pipeline-corpus.test.ts`: for each fixture,
      assert the secret token is absent from the filtered result;
      negatives assert benign text survives and no false-positive
      redaction warning. Verify (GREEN) after Phase 4 impl.

## Phase 6 — `resolveSafeReadPath` sandbox gate (§5.2/§8a) — RED then GREEN

- [ ] `test/resolve-safe-read-path.test.ts` (RED) using a temp
      dir as `projectRoot` (`fs.mkdtempSync`), with real symlinks:
      accepts in-sandbox relative + absolute paths; rejects
      `..`-traversal escaping all roots with
      `OutputFilterError("path_unsafe")`; rejects an absolute path
      outside `{projectRoot,cwd,HOME}`; rejects a symlink whose
      realpath escapes the sandbox; accepts a symlink that stays
      inside; non-existent in-sandbox target resolves via nearest
      existing ancestor (no throw).
- [ ] Implement `src/resolve-safe-read-path.ts` (the ONLY module
      importing `node:fs`/`node:path`/`node:os`); containment via
      `path.relative` not-`..`/not-absolute on
      `{projectRoot, process.cwd(), os.homedir()}`.
      Verify (GREEN): all cases pass.

## Phase 7 — Public barrel + final assembly

- [ ] Fill `src/index.ts` to re-export ONLY the public surface
      (spec §5). No internal stage module is exported.
- [ ] `pnpm --filter @megasaver/output-filter build`.
      Verify: `dist/index.js` + `dist/index.d.ts` emitted; `.d.ts`
      surface matches spec §5.

## Phase 8 — Verify gate (whole monorepo)

- [ ] From the worktree root run `pnpm verify` (lint + typecheck +
      test). Honest evidence only — paste real passing output.
      Verify: exits 0; output-filter unit + property + corpus +
      test-d + dependency-graph all pass; no other package
      regressed.

## Phase 9 — Changeset + review + commit

- [ ] Add a changeset (new public package surface — DoD §9 item 9).
- [ ] `security-reviewer` audit of the redaction choke point and
      `resolveSafeReadPath` (HIGH risk, mandatory; author ≠
      reviewer per DoD §9 item 6).
- [ ] `code-reviewer`/`critic` pre-merge review.
- [ ] Commit (Conventional Commits, subject ≤50 chars), e.g.
      `feat(output-filter): add filterOutput + safe-read gate`.
      Body explains the redact-first invariant only if non-obvious.

## Out of scope (do NOT do in BB5)

- No edits to `@megasaver/core`, content-store, retrieval, stats,
  mcp-bridge, or apps.
- No re-implementation of redaction patterns (owned by policy).
- No content-store placeholder dedupe (content-store absent in
  this worktree; tracked as a BB4 follow-up).
- No `pnpm-workspace.yaml` edit.

## Verification summary (DoD §9)

1. Spec: §1 file above. 2. Plan: this file. 3. Tests first: every
phase RED→GREEN. 4. `pnpm verify` green (Phase 8). 5. Smoke:
large-blob filter evidence in `filter-output.test.ts`. 6/7.
External `security-reviewer` + `code-reviewer` + verifier
(Phase 9). 8. Zero pending todos. 9. Changeset. 10. No convention
changes in BB5 (the BB3 anti-pattern entry already shipped).
