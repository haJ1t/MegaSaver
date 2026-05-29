---
title: BB4 — @megasaver/content-store TDD plan
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB4
spec: docs/superpowers/specs/2026-05-10-bb4-content-store-design.md
---

# BB4 — `@megasaver/content-store` TDD plan

Execute in order. TDD: write failing tests first, then implement until
green. Work ONLY in
`/Users/halitozger/Desktop/MegaSaver/.worktrees/bb4-content-store`.
Verify gate: `pnpm verify` at the worktree root
(lint + typecheck + test + conventions:check). Honest evidence only.

Mirror `packages/shared/` scaffold exactly. Mirror enum/error/test-d
patterns from `packages/output-filter/` and
`packages/shared/test/token-saver-mode.test-d.ts`.

---

## Phase 0 — Package scaffold

- [ ] Create `packages/content-store/package.json` (mirror
      `packages/shared/package.json`): name `@megasaver/content-store`,
      `version 0.0.0`, `private: true`, `type: module`,
      `main/types/exports → ./dist`, `files: ["dist"]`,
      `sideEffects: false`, scripts `build/dev/test/test:watch/typecheck/clean`
      identical to shared. `dependencies`: `@megasaver/output-filter`
      `workspace:*`, `@megasaver/shared` `workspace:*`, `zod ^3.24.1`.
      `devDependencies`: `@types/node ^22.19.17`, `fast-check ^3.23.2`,
      `@megasaver/core` `workspace:*` (test fixture only, §6).
- [ ] Create `tsconfig.json`, `tsconfig.test.json`, `tsconfig.test-d.json`,
      `tsup.config.ts`, `vitest.config.ts` — byte-mirror shared's, only
      package-local paths differ (there are none to change).
- [ ] Create `src/index.ts` empty barrel placeholder (filled in Phase 5).
- [ ] Run `pnpm install` at the worktree root so the new workspace
      package links. Then `pnpm --filter @megasaver/content-store build`
      to confirm scaffold compiles (empty barrel).
      → verify: install + build succeed; package appears in workspace.

## Phase 1 — Closed enum + error (tests first)

- [ ] Write `test/error-code.test-d.ts` — AA3 tuple pin, mirroring
      `packages/shared/test/token-saver-mode.test-d.ts`: members
      assignable; non-member `@ts-expect-error`; `.options` spread;
      `.options` equals readonly tuple
      `["not_found", "schema_invalid", "store_corrupt", "write_failed"]`.
      → expect: typecheck fails (no source yet).
- [ ] Implement `src/errors.ts`: `contentStoreErrorCodeSchema`
      (alphabetic `z.enum`), `ContentStoreErrorCode` type,
      `ContentStoreError extends Error` with `readonly code` and
      `{ cause }` option (mirror `output-filter/src/errors.ts`).
      → verify: `vitest typecheck` green for `error-code.test-d.ts`.

## Phase 2 — Schemas + discriminator pin (tests first)

- [ ] Write `test/source-discriminator.test-d.ts` — assert the
      `chunkSetSchema` `source.kind` union equals
      `outputSourceKindSchema.options` (no drift from `OutputSourceKind`).
      → expect: fails (no schema yet).
- [ ] Write `test/chunk-set.test.ts` — `chunkSetSchema` accepts a valid
      chunkSet; rejects extra keys (`.strict`); rejects negative
      `startLine`/`bytes`/`rawBytes`; rejects non-uuid `projectId`;
      requires `redacted` boolean; `redacted` roundtrips through
      parse→serialize→parse for both `true` and `false`.
      → expect: fails.
- [ ] Implement `src/chunk-set.ts`: `chunkSchema`, `chunkSetSchema`
      (source discriminated union per spec §4a, importing
      `outputSourceKindSchema`/`OutputSourceKind` from
      `@megasaver/output-filter` and `projectIdSchema`/`sessionIdSchema`
      from `@megasaver/shared`), `Chunk`/`ChunkSet`/`ChunkSetSummary`
      types.
      → verify: `chunk-set.test.ts` + `source-discriminator.test-d.ts`
      green.

## Phase 3 — Atomic write + paths (tests first)

- [ ] Write `test/atomic-write-behavior.test.ts` — five §6 scenarios
      (success / crash-during-rename / crash-after-rename /
      dir-symlink-attack / parent-doesn't-exist) run against BOTH the
      content-store impl and core's atomic write (test fixture via
      core's public write surface, or guarded deep import per OQ-1),
      asserting identical observable outcomes. Use `node:os.tmpdir` +
      `mkdtempSync` for isolated temp stores; clean up in `afterEach`.
      → expect: fails (no atomic-write source).
- [ ] Implement `src/atomic-write.ts` — port
      `json-directory-store.ts:235–286`: `IS_WIN32` at module load;
      symlinked-parent refusal; recursive mkdir; temp-write + fsync +
      rename + POSIX dir-fsync; failure cleanup; throw
      `ContentStoreError("write_failed", …, { cause })`.
- [ ] Implement `src/paths.ts` — compute
      `<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json`;
      `assertSafeSegment(chunkSetId)` rejecting `/`, `\`, `.`, `..`.
      → verify: `atomic-write-behavior.test.ts` green.

## Phase 4 — Store API (tests first)

- [ ] Write `test/store.test.ts` covering spec §9 acceptance:
      - save→load deep-equal roundtrip; delete then load throws `not_found`;
      - load of never-written id throws `not_found`;
      - load of corrupt file throws `store_corrupt`;
      - save of schema-invalid input throws `schema_invalid`;
      - `deleteChunkSet` of absent file is idempotent (no throw);
      - `listChunkSets` returns `[]` for empty session; returns summaries
        with correct `chunkCount`; corrupt file → `store_corrupt`;
      - `pruneOlderThan` removes only `createdAt < olderThan`, returns
        correct `removed`, skips corrupt files, `{ removed: 0 }` when no
        `content/` root;
      - **redaction flag preserved** for `true` and `false`.
      Use injected `olderThan` Dates; isolated temp store per test.
      → expect: fails.
- [ ] Implement `src/store.ts` — `saveChunkSet`, `loadChunkSet`,
      `listChunkSets`, `deleteChunkSet`, `pruneOlderThan` per spec §5,
      using `atomic-write.ts` + `paths.ts` + boundary Zod validation.
      Re-validate `projectId`/`sessionId` at load/list/delete boundary.
      → verify: `store.test.ts` green.

## Phase 5 — Barrel + dependency-graph guard

- [ ] Fill `src/index.ts` — re-export ONLY the public surface (spec §4):
      schemas + types from `chunk-set.ts`, functions from `store.ts`,
      `ContentStoreError` + `contentStoreErrorCodeSchema` +
      `ContentStoreErrorCode` from `errors.ts`. Nothing else.
- [ ] Write `test/dependency-graph.test.ts` — mirror
      `packages/output-filter/test/dependency-graph.test.ts`:
      `ALLOWED_DEPENDENCIES = ["@megasaver/output-filter", "@megasaver/shared", "zod"]`;
      assert `dependencies` keys ⊆ allow-list; assert not contains
      `@megasaver/core`; assert `dependencies` keys === allow-list sorted.
      → verify: green (core is a devDependency, not a dependency).

## Phase 6 — Verify, changeset, commit

- [ ] `pnpm --filter @megasaver/content-store build` → emits `dist/`.
- [ ] `pnpm --filter @megasaver/content-store test` → all unit +
      test-d green. Capture real output.
- [ ] `pnpm verify` at worktree root → lint + typecheck + test +
      conventions:check all green. Capture real output (no green claim
      without it).
- [ ] Add a changeset (DoD #9 — new public package surface):
      `.changeset/*.md` describing the new `@megasaver/content-store`
      package.
- [ ] Confirm no `@megasaver/core` import in any `src/**` file (only in
      `test/atomic-write-behavior.test.ts`).
- [ ] Commit on a feature branch (do not commit to a default branch):
      `feat(content-store): add ChunkSet persistence package`.
      Conventional Commits, subject ≤50 chars.

## Phase 7 — Review handoff (HIGH chain)

- [ ] External `code-reviewer` (or `critic`) pass — author ≠ reviewer
      context (DoD #6).
- [ ] `architect` design confirmation + `critic` adversarial review
      (HIGH risk per spec §1 / CLAUDE.md §12).
- [ ] `verifier` agent pass (DoD #7).
- [ ] Zero pending todo items (DoD #8).

---

## File map (every new file)

| File | Phase | Type |
|------|-------|------|
| `packages/content-store/package.json` | 0 | scaffold |
| `packages/content-store/tsconfig.json` | 0 | scaffold |
| `packages/content-store/tsconfig.test.json` | 0 | scaffold |
| `packages/content-store/tsconfig.test-d.json` | 0 | scaffold |
| `packages/content-store/tsup.config.ts` | 0 | scaffold |
| `packages/content-store/vitest.config.ts` | 0 | scaffold |
| `packages/content-store/src/index.ts` | 0/5 | barrel |
| `packages/content-store/src/errors.ts` | 1 | impl |
| `packages/content-store/src/chunk-set.ts` | 2 | impl |
| `packages/content-store/src/atomic-write.ts` | 3 | impl |
| `packages/content-store/src/paths.ts` | 3 | impl |
| `packages/content-store/src/store.ts` | 4 | impl |
| `packages/content-store/test/error-code.test-d.ts` | 1 | test-d pin (AA3) |
| `packages/content-store/test/source-discriminator.test-d.ts` | 2 | test-d pin |
| `packages/content-store/test/chunk-set.test.ts` | 2 | test |
| `packages/content-store/test/atomic-write-behavior.test.ts` | 3 | test (§10c parity) |
| `packages/content-store/test/store.test.ts` | 4 | test |
| `packages/content-store/test/dependency-graph.test.ts` | 5 | test (§3c guard) |
| `.changeset/<slug>.md` | 6 | changeset |

## Definition of Done (CLAUDE.md §9)

1. Spec ✓ (`…bb4-content-store-design.md`). 2. Plan ✓ (this file).
3. Tests-first ✓ (Phases 1–5). 4. `pnpm verify` green (Phase 6).
5. Smoke evidence (build dist + roundtrip test output). 6. External
reviewer (Phase 7). 7. Verifier (Phase 7). 8. Zero pending todos.
9. Changeset (Phase 6). 10. No conventions changed → no agent-file edits.
