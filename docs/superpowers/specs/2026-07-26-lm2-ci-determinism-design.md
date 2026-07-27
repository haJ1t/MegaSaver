# Make LM2 verification deterministic under CI contention

- Status: user-authorized release correction
- Risk: **MEDIUM** — test-only change that gates a high-risk long-memory release
- Source: GitHub Actions run `30208733506`, Ubuntu job `89811271418`

## Problem

The release verification is not deterministic on a two-runner GitHub Actions
matrix. Ubuntu failed four long-memory assertions while the same package suite
passed locally (413 tests).

The failures have three independent causes:

1. The general LM2 index test harness gives normal multi-batch tests a
   100 ms operation deadline. Under CI contention the deadline fires between
   batches. The harness then reports `evidence_changed`, which is the expected
   consequence of its deadline-aware recheck, not a product evidence failure.
2. Two LM1 store tests rebuild `@megasaver/shared` and `@megasaver/long-memory`
   while Vitest is executing other files. A concurrently spawned catalog child
   resolves the shared package through `dist/index.js`; tsup briefly replaces
   that directory and the child sees `ERR_MODULE_NOT_FOUND`.
3. The bounded-recall test publishes several independent snapshots with the
   same `observedAt`. Its asserted `current` snapshot is the first one outside
   the lexical scan window, but current-state selection uses an ID tie-breaker.
   Directory order therefore changes which tied snapshot wins.

## Decision

Keep production code and production deadlines unchanged. Make the fixtures
express their intended conditions explicitly:

- Set the harness default deadline to the existing maximum test-safe LM2 batch
  deadline (15 seconds). Tests whose subject is a short timeout already pass an
  explicit `timeoutMs`; retain those explicit values except the stalled-approval
  fixture, whose 500 ms setup budget can expire before it observes existing
  progress under a full Turborepo run. That fixture uses 5 seconds solely to
  reach its intentionally stalled approval, while its test ceiling is 10 seconds.
- Remove the per-test `pnpm build` helper. The root `verify` workflow builds
  workspace dependencies before tests, and package test children consume that
  stable artifact. This eliminates the concurrent mutation of `dist/`.
- Give each independently published snapshot in the bounded-recall scenario a
  strictly later canonical timestamp. The asserted record is then objectively
  the current state, independent of filesystem enumeration order.

## Acceptance criteria

1. The focused long-memory suite passes with test-file concurrency enabled.
2. No long-memory test mutates workspace `dist/` during test execution.
3. The three capacity/evidence tests reach their stated 128/256-record
   conditions on a loaded CI runner.
4. The bounded recall case always selects its latest snapshot.
5. `pnpm verify` passes on Ubuntu and Windows, followed by the standalone CLI
   bundle smoke check.

## Out of scope

No long-memory runtime logic, public API, timeout policy, persistence schema,
or generated release artifact changes. This is a deterministic-test correction
only.

## Amendment: Windows evidence-fixture portability

Independent release review found that `createEvidenceFixture` shells out to
Unix `find` when recording package-file hashes. GitHub's Windows runner treats
that command as Windows `FIND`, rejects `-type`, and prevents the LM2 evidence
tests from starting. Replace only this file enumeration with a Node `readdir`
walk. Preserve regular-file-only semantics, root-relative slash-separated paths,
and SHA-256 values; leave the archive and verifier behavior unchanged.

## Amendment: deterministic live-publication timeout protocol

The release-record PR `#318` exposed one remaining CI-only race in
`lm2-index.test.ts`. The test that proves an active publication is drained
before finalization used a five-millisecond real deadline, waited fifteen real
milliseconds, and assumed the publication had already started. Under a loaded
runner, setup can consume the five milliseconds before `publishBatch` starts;
the valid immediate timeout then leaves the test waiting for an event that can
never occur.

Keep the indexer's production clock and deadline behavior unchanged. The test
will instead use the already-established `node:perf_hooks` clock seam and
Vitest fake timers: a controlled `performance.now()` begins at zero, the
publication signals that it is live, the test advances its controlled clock and
the timeout timer together, and only then releases the publication gate. This
preserves the exact production contract under test: a timeout during a live
publication drains that work, finalizes once, reports its committed prefix, and
retries at the first uncommitted record.

### Acceptance criteria

1. The regression test contains no real-time sleep and no sub-second setup
   deadline.
2. It deterministically observes a live `publishBatch` before expiring the
   deadline.
3. It still proves finalization waits for the gated publication and preserves
   the single committed record in the retry receipt.
4. Production source, public API, timeout policy, and persistence schema remain
   unchanged.
