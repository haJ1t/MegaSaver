# Task 4 — Compose and export the production LM2 runtime

Date: 2026-07-20
Branch: `codex/feat/long-memory-hybrid-recall`
Risk: HIGH
Implementation lineage: `842af816` (Task 4 base) → `767a8213` (runtime implementation) → this review-fix commit

## Outcome

Task 4 added the public `createLm2Runtime` composition root. It combines LM1
capture/recall, the LM2 catalog, vector store, ranker, and indexer while keeping
Safe recall a literal LM1 path with no semantic port calls. Adaptive recall uses
the configured active model fingerprint, loads its candidates from the bounded
LM2 capture catalog, ranks them through LM2, and hands the fused scores to the
same LM1 structural/evidence selector used by Safe recall.

The factory validates configuration before inspecting capability ports, treats
hostile or structurally unreadable ports as explicit degradation states, rejects
unadmitted index fingerprints before index I/O, and keeps the string clock used
for capture separate from the monotonic semantic deadline clock. Remote query
approval now runs only inside the semantic lane's abortable query deadline; a
never-resolving approval returns lexical results with an exact `timeout`
degradation and performs no query embedding egress.

Capture publication remains authoritative if the subsequent catalog append
fails. Cataloging occurs only after successful LM1 publication. Task 5 files and
benchmark artifacts were not changed.

## Exact implementation diff

Commit `767a8213` changed these files relative to `842af816`:

- `packages/long-memory/src/index.ts`
- `packages/long-memory/src/lm1-fused-selector.ts` (new)
- `packages/long-memory/src/lm1-recall.ts`
- `packages/long-memory/src/lm1-selector-state.ts` (new)
- `packages/long-memory/src/lm2-model.ts`
- `packages/long-memory/src/lm2-runtime-candidates.ts` (new)
- `packages/long-memory/src/lm2-runtime-ports.ts` (new)
- `packages/long-memory/src/lm2-runtime-recall.ts` (new)
- `packages/long-memory/src/lm2-runtime.ts` (new)
- `packages/long-memory/test/index.test-d.ts`
- `packages/long-memory/test/lm2-model.test.ts`
- `packages/long-memory/test/lm2-runtime-adaptive.test.ts` (new)
- `packages/long-memory/test/lm2-runtime-fixtures.ts` (new)
- `packages/long-memory/test/lm2-runtime-matrix.test.ts` (new)
- `packages/long-memory/test/lm2-runtime.test.ts` (new)

The narrow review follow-up changes only:

- `.superpowers/sdd/task-4-report.md`
- `packages/long-memory/src/lm2-model-contracts.ts` (new)
- `packages/long-memory/src/lm2-model.ts`
- `packages/long-memory/src/lm2-runtime-model.ts` (new)
- `packages/long-memory/src/lm2-runtime-recall.ts`
- `packages/long-memory/src/lm2-semantic-lane.ts`
- `packages/long-memory/test/lm2-model.test.ts`
- `packages/long-memory/test/lm2-runtime-matrix.test.ts`

## TDD evidence

### Initial runtime RED

The first focused runtime execution failed before production implementation:

```text
pnpm --filter @megasaver/long-memory test -- lm2-runtime.test.ts lm2-runtime-matrix.test.ts lm2-runtime-adaptive.test.ts
```

Observed failures included unresolved `../src/lm2-runtime.js` imports, two model
configuration assertions because the active recall fingerprint was not yet part
of the strict schema, and the root API type assertion because
`createLm2Runtime` was not exported.

### Review RED: source limit

```text
pnpm exec vitest run test/lm2-model.test.ts
```

Observed:

```text
Test Files  1 failed (1)
Tests       1 failed | 8 passed (9)
expected 310 to be less than or equal to 300
```

The model contracts were then split without changing existing imports:

```text
packages/long-memory/src/lm2-model.ts             194 lines
packages/long-memory/src/lm2-model-contracts.ts    45 lines
packages/long-memory/src/lm2-runtime-model.ts      147 lines
```

### Review RED: unbounded remote approval

```text
pnpm exec vitest run test/lm2-runtime-matrix.test.ts --typecheck.enabled false
```

With `queryTimeoutMs: 5` and a nonresolving approval, the bounded watchdog won:

```text
Test Files  1 failed (1)
Tests       1 failed | 11 passed (12)
expected Symbol(stalled) not to be Symbol(stalled)
```

Tracing showed that `lm2-runtime-recall.ts` awaited a duplicate approval
preflight before `rankLm2Candidates` created its abort controller and deadline.
The fix delegates approval to the semantic lane and retains remote-denial
classification for an empty vector set inside that same bounded operation.

### Focused GREEN

```text
pnpm exec vitest run \
  test/lm1-recall.test.ts \
  test/lm1-transition.test.ts \
  test/lm1-runtime.test.ts \
  test/lm2-model.test.ts \
  test/lm2-ranker.test.ts \
  test/lm2-runtime.test.ts \
  test/lm2-runtime-matrix.test.ts \
  test/lm2-runtime-adaptive.test.ts \
  test/index.test-d.ts
```

Observed:

```text
Test Files  10 passed (10)
Tests       85 passed (85)
Type Errors no errors
```

The deadline regression asserts the complete degraded receipt, including
`semanticReasons: ["timeout"]`, `queryLatencyMs: 5`, one indexed vector, lexical
fallback output, one document-only embedding call, and no query embedding call.

## Verification

Before review, commit `767a8213` passed `pnpm verify`: all 56 Turbo tasks passed,
including 33 long-memory test files and 307 tests, with no type errors. After
the review fixes, the package build (including declarations), package
typecheck, focused runtime/LM1/API tests, Biome, `git diff --check`, and all
changed-source LOC checks passed. The final `pnpm verify` exited 0 with all 56
Turbo tasks successful; long-memory passed 33 test files and 309 tests with no
type errors, and the conventions drift check passed.

No benchmark score is claimed by Task 4. No merge, push, or Task 5 change was
performed.
