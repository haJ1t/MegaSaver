---
title: BB7a — mega output {file,filter,chunk} CLI — TDD plan
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB7a
spec: docs/superpowers/specs/2026-05-10-bb7a-output-cli-design.md
---

# BB7a TDD plan — `mega output {file,filter,chunk}`

Execution discipline: failing tests first (CLAUDE.md §4, §9.3),
then implementation, then `pnpm verify`, then commit. Author and
reviewer are never the same active context (§9.6). All work in the
worktree `/.worktrees/bb7a-output-cli` only.

## File map

### New source files (`apps/cli/src/commands/output/`)
- [ ] `index.ts` — `outputCommand` + re-exports (mirror `session/index.ts`).
- [ ] `file.ts` — `runOutputFile` + `outputFileCommand` (≤300 LOC).
- [ ] `filter.ts` — `runOutputFilter` + `outputFilterCommand` (≤300 LOC).
- [ ] `chunk.ts` — `runOutputChunk` + `outputChunkCommand` (≤300 LOC).
- [ ] `locate-chunk-set.ts` — `locateChunkSet` directory-walk helper.
- [ ] `shared.ts` — shared session→project/settings derivation +
      ChunkSet construction helper (only if `file.ts`+`filter.ts`
      would otherwise duplicate >3 lines; §13).

### Edited source files
- [ ] `apps/cli/src/main.ts` — register `output: outputCommand`.
- [ ] `apps/cli/src/errors.ts` — add `ZodContext` members + message
      builders for the §6 error codes (extend; do not rewrite).
- [ ] `apps/cli/package.json` — add `@megasaver/policy`,
      `@megasaver/output-filter`, `@megasaver/content-store` as
      `workspace:*`.

### New test files (`apps/cli/test/`)
- [ ] `output/file.test.ts` — gate order, store, settings derivation.
- [ ] `output/filter.test.ts` — log pipeline, `--file` required.
- [ ] `output/chunk.test.ts` — locate + return + miss codes.
- [ ] `output/locate-chunk-set.test.ts` — walk hit/miss/no-content-dir.
- [ ] `dependency-graph.test.ts` — §3c allow-list guard for apps/cli.
- [ ] `output/no-child-process.test.ts` — assert no `child_process`
      import in `src/commands/output/**` (read source, grep guard).

### Edited test files
- [ ] `apps/cli/test/json-failure-paths.test.ts` — add `output file`/
      `output filter`/`output chunk` failure-path cases (§6 codes).

### Tuple pins / scaffold
- None. BB7a introduces no new package and no new closed enum
  (§17), so no `*.test-d.ts` and no package scaffold are created.

## Phase 0 — wiring & failing dep-graph test (RED)

- [ ] Add the three `workspace:*` deps to `apps/cli/package.json`.
- [ ] Re-run `pnpm install` in the worktree (workspace links).
- [ ] Write `apps/cli/test/dependency-graph.test.ts`: parse
      `apps/cli/package.json` deps; assert `@megasaver/*` keys ⊆
      {shared, core, policy, output-filter, content-store,
      connectors-shared, connector-generic-cli}; assert NOT in deps:
      mcp-bridge, retrieval, stats. Run → expect RED until deps added,
      then GREEN (this test also locks the allow-list going forward).
- [ ] Verify: `pnpm --filter @megasaver/cli test dependency-graph` green.

## Phase 1 — failing command tests (RED)

Write tests against the not-yet-existing `run*` functions. Each
test injects `now`/`newId` and uses `mkdtemp` stores seeded with a
project + session (mirror `json-failure-paths.test.ts` `seedProject`).

- [ ] `output/locate-chunk-set.test.ts`:
  - hit: seeded `<store>/content/<pid>/<sid>/<csid>.json` → returns
    `{ projectId, sessionId }`.
  - miss: unknown id → `null`.
  - no `content/` dir → `null`.
- [ ] `output/file.test.ts`:
  - happy: valid session + intent + in-sandbox file → exit 0,
    `result` shape, `chunkSetId` set when `storeRawOutput` true,
    chunk-set persisted on disk.
  - `storeRawOutput=false` session → exit 0, no `chunkSetId`, no file
    written (assert content dir empty).
  - `--intent` missing → `intent_required`, exit 1, no read (fs spy
    asserts `readFile` never called).
  - policy denial: a `.env`-style path → `path_denied: secret_path_read`,
    exit 1, **no read attempted**.
  - sandbox escape: `../../etc/passwd` style → `path_unsafe`, exit 1,
    no read.
  - nonexistent in-sandbox path → `file_read_failed`, exit 1.
  - nonexistent session → `session_not_found`, exit 1.
  - pre-AA session (`tokenSaver` undefined) → defaults applied,
    exit 0.
- [ ] `output/filter.test.ts`:
  - happy: `--file` log in sandbox → exit 0, `result` shape.
  - `--file` missing → `file_required`, exit 1.
  - `--intent` missing → `intent_required`, exit 1.
  - same two-gate denials as `file` (policy + sandbox).
- [ ] `output/chunk.test.ts`:
  - happy: stored chunk-set, valid chunkId → exit 0, `{ chunkSetId,
    chunkId, chunk }` shape, text printed in text mode.
  - unknown chunk-set id → `chunk_set_not_found`, exit 1.
  - known chunk-set, unknown chunkId → `chunk_not_found`, exit 1.
  - empty `<chunk-set-id>` → `invalid_chunk_set_id`, exit 1.
  - corrupt stored file → `store_corrupt`, exit 1.
- [ ] `output/no-child-process.test.ts`: read each
  `src/commands/output/*.ts` source; assert none contains
  `child_process` / `node:child_process` / `spawn`.
- [ ] Extend `json-failure-paths.test.ts`: one `--json` failure case
  each for `runOutputFile` (intent missing), `runOutputFilter`
  (file missing), `runOutputChunk` (not found) — each asserts empty
  stdout, non-JSON stderr, exit 1.
- [ ] Run the new suites → expect RED (functions/commands absent).

## Phase 2 — implementation (GREEN)

- [ ] `errors.ts`: add `ZodContext` members + builders for §6 codes;
      reuse `sessionNotFoundMessage`. Keep `exitCode: 1`.
- [ ] `locate-chunk-set.ts`: `readdirSync` walk over
      `<store>/content/*/*/`; ENOENT → `null`.
- [ ] `file.ts`: implement the §3a pipeline. Order is load-bearing:
      intent check → session/project/settings → policy gate →
      sandbox gate → `readFile` → `filterOutput` → optional
      `saveChunkSet`. Inject `now`/`newId`.
- [ ] `filter.ts`: implement §3b (path from `--file`, same gates).
      Extract shared session→settings + ChunkSet build into
      `shared.ts` only if duplication exceeds the §13 threshold.
- [ ] `chunk.ts`: implement §3c (validate ids → `locateChunkSet` →
      `loadChunkSet` → find chunk → emit).
- [ ] `index.ts`: `outputCommand` + re-exports.
- [ ] `main.ts`: register `output`.
- [ ] Run `pnpm --filter @megasaver/cli test` → drive all new suites
      GREEN. Confirm each file ≤300 LOC.

## Phase 3 — verify (DoD §9.4)

- [ ] `pnpm verify` from the worktree root (lint + typecheck + test,
      whole monorepo). Capture honest passing output — no green claim
      without real output.
- [ ] Confirm zero pending checkboxes in this plan.
- [ ] Changeset: not required (apps/cli is private, `version 0.0.0`,
      no public package API change). Note explicitly in the PR.

## Phase 4 — review & commit

- [ ] Request `code-reviewer` + `critic` (HIGH risk, §12). Author ≠
      reviewer context (§9.6).
- [ ] `verifier` pass (`omc:verify`).
- [ ] Commit (Conventional Commits, ≤50-char subject), e.g.
      `feat(cli): add mega output file/filter/chunk`. Body explains
      the two-gate read-safety invariant (the non-obvious WHY).

## Guardrails (Must / Must NOT)

**Must:** two gates before every read; injected clock/id; extend
(not rewrite) `errors.ts` and `json-failure-paths.test.ts`; kebab
files ≤300 LOC; Zod at the CLI boundary only; honest `pnpm verify`.

**Must NOT:** implement `exec` / spawn / `evaluateCommand` /
`MEGASAVER_ORIGIN_PID`; create a new package or closed enum; import
`@megasaver/{mcp-bridge,retrieval,stats}`; add defensive checks for
impossible cases; promote `locateChunkSet` into content-store now.
