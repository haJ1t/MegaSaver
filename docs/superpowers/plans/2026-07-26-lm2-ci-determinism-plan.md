# LM2 CI Determinism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LM2/LM1 long-memory verification fixtures deterministic on the GitHub Actions matrix.

**Architecture:** Change only test fixtures. The index harness receives a test-safe default deadline; child-process tests consume the build produced by the workflow; the bounded-recall fixture has an explicit chronological order.

**Tech Stack:** TypeScript, Vitest, pnpm, Turborepo, GitHub Actions.

## Global Constraints

- Keep production source and public behavior unchanged.
- Preserve explicit short-timeout tests.
- Do not run a workspace build from a concurrently executing Vitest test.
- Verify with the full `pnpm verify` matrix after the focused suite.

---

### Task 1: Stabilize the index and child-process fixtures

**Files:**
- Modify: `packages/long-memory/test/lm2-index.test.ts`
- Modify: `packages/long-memory/test/lm1-store.test.ts`

**Interfaces:**
- Consumes: `MAX_LM2_INDEX_BATCH_TIMEOUT_MS` already exported from `lm2-model.ts`.
- Produces: a harness whose normal tests have a 15-second deadline and child
  processes that use the stable pre-test workspace artifacts.

- [ ] **Step 1: Preserve the CI failure as a focused red run**

Run: `pnpm --filter @megasaver/long-memory exec vitest run --poolOptions.forks.minForks=2 --poolOptions.forks.maxForks=2`

Expected before the correction on a constrained runner: the 100 ms default can
finish a multi-batch fixture after only one 16-record batch and the child
fixture can observe a missing shared `dist/index.js`.

- [ ] **Step 2: Make normal multi-batch fixtures deadline-independent**

Change the `createLm2IndexService` test-harness option from `defaultTimeoutMs:
100` to `defaultTimeoutMs: MAX_LM2_INDEX_BATCH_TIMEOUT_MS`. Keep explicit
short timeout requests intact, except the stalled-approval fixture: change its
`timeoutMs` from `500` to `5_000` and its Vitest ceiling from `5_000` to
`10_000`, so the test reaches the intended pending approval before timing out
under a full Turborepo run.

- [ ] **Step 3: Remove concurrent workspace rebuilding**

Delete `execFileSync` and `buildChildRuntime` from `lm1-store.test.ts`, then
remove its two call sites immediately before `publishInChild`. The workflow
already completes `turbo build` before `turbo test`, so children read stable
compiled workspace packages.

- [ ] **Step 4: Verify the focused suite**

Run: `pnpm --filter @megasaver/long-memory exec vitest run --poolOptions.forks.minForks=2 --poolOptions.forks.maxForks=2`

Expected: 45 files / 413 tests pass, with no `ERR_MODULE_NOT_FOUND`.

### Task 2: Give the bounded-recall fixture a chronological winner

**Files:**
- Modify: `packages/long-memory/test/lm1-store.test.ts`

**Interfaces:**
- Consumes: `createRecord({ observedAt })` and current-state selection's
  `observedAt` ordering.
- Produces: a record asserted as current because it has the latest timestamp,
  not because of a file enumeration side effect.

- [ ] **Step 1: Preserve the nondeterministic fixture as red evidence**

The existing fixture uses the same timestamp for every independent candidate.
The CI failure demonstrates the wrong tied record can be selected.

- [ ] **Step 2: Use a strictly later canonical timestamp per candidate**

Replace the fixed candidate `observedAt` with
`new Date(Date.UTC(2026, 6, 20, 0, 0, index + 1)).toISOString()` in the
bounded-recall test. This preserves the intended newer-than-predecessor
relationship and gives the selected candidate a unique chronological priority.

- [ ] **Step 3: Verify the specific case**

Run: `pnpm --filter @megasaver/long-memory test -- lm1-store.test.ts`

Expected: the bounded-recall case selects the newly published latest snapshot
on repeated runs.

### Task 3: Release verification and records

**Files:**
- Modify: `wiki/agent-channel.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Run the complete gate**

Run: `pnpm verify`

Expected: lint, typecheck, all tests, conventions, and bundle smoke pass.

- [ ] **Step 2: Update the project record**

Record the failed CI evidence, the three fixture causes, exact focused-suite
result, and full-verification result in the wiki log and agent channel.

- [ ] **Step 3: Obtain fresh independent review**

Have a reviewer inspect the final diff and rerun/check the focused suite before
the repaired PR is merged.

### Task 4: Remove the Unix-only LM2 fixture dependency

**Files:**
- Modify: `packages/long-memory/test/lm2-completion-fixtures.ts`
- Modify: `packages/long-memory/test/lm2-completion-integration.test.ts`

**Interfaces:**
- Produces: `listPackageFiles(root, directory)`, a test-fixture helper returning
  `{ path, sha256 }` rows for every regular file below the package directory.
- Preserves: evidence paths relative to `root`, normalized with `/`, and each
  file's SHA-256.

- [ ] **Step 1: Add the failing portability contract**

Add an integration test that imports the fixture module dynamically, asserts
that `listPackageFiles` is exported, and compares its result with
`fixture.evidence.leaderboard.packageFiles`.

Run: `pnpm --filter @megasaver/long-memory test -- lm2-completion-integration.test.ts`

Expected before the correction: FAIL because `listPackageFiles` is absent.

- [ ] **Step 2: Replace the Unix `find` invocation**

Implement `listPackageFiles` using `readdirSync(path, { withFileTypes: true })`.
Visit directory entries in deterministic name order, recurse into directories,
include only `entry.isFile()` values, and normalize each root-relative path with
`sep` to `/` before hashing its bytes. Use this helper in `createEvidenceFixture`.

- [ ] **Step 3: Verify cross-platform-ready evidence construction**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-completion-integration.test.ts`

Expected: the fixture's evidence gate tests pass without invoking Unix `find`.
