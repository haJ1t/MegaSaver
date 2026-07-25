---
risk: MEDIUM
status: implemented
source: intermittent `pnpm verify` failure observed across several unrelated branches
---

# Connector test timeout — design

## Problem

`packages/connectors/claude-code/test/public-export.test.ts` intermittently
fails during a full `pnpm verify` / `pnpm turbo run test --force`:

```
FAIL test/public-export.test.ts > public exports > built package exposes the documented runtime surface
Error: Test timed out in 5000ms.
```

It passes 128/128 when the package is tested alone. Observed on several
unrelated branches, so it is not tied to any one change.

## What the investigation actually found

The original hypotheses were mostly wrong, and the measurements say so:

- **"A race against an in-progress build."** No. `turbo.json` declares
  `test.dependsOn: ["^build", "build"]`, so the package's own build is complete
  before its test task starts. Not a partial-write race.
- **"A large freshly-built bundle."** No. `dist/index.js` is 25 KB. The cost is
  the transitive workspace graph it pulls in, not the entry file.
- **"Hoist the two `import()` calls into `beforeAll` so the bundle loads once."**
  Pointless *as stated* — first import 205 ms, second **0.0 ms**, so the ESM
  module cache already makes the second free, and `hookTimeout` was 5 s too. But
  that measurement answers the wrong question. The question is whether the first
  import belongs inside a timed test at all, and both sibling packages already
  answer no: `connectors/shared` and `connectors/generic-cli` use a **static
  top-level** `import * as pkg from "../dist/index.js"`, so their dist load is
  paid during collection, which no per-test budget governs. `claude-code` was
  the only one of the three charging it to the test.

There are two findings, and the first is the one that matters.

**1. The test charged a module-graph load to a per-test budget.** `claude-code`
was the only `public-export.test.ts` of the three using a dynamic
`await import()` inside the test body. Idle that is ~450 ms for the file; under
a full `turbo run test` — 28 vitest processes, each with worker pools and an
in-process `tsc` typecheck — it is the cost that closes a 5 s margin.

**2. Config drift.** 25 of the 28 vitest configs under the pnpm workspace
(`apps/*`, `packages/*`, `packages/connectors/*`) set `testTimeout: 30_000` and
`hookTimeout: 30_000`. The three exceptions are the connector packages, sitting
on vitest's 5 s default. (`scripts/conventions-sync/vitest.config.ts` also lacks
the pair, but it is outside the workspace globs and never runs under
`turbo test` or `pnpm verify`.) There is no shared base config; each package
repeats the pair by hand, which is how three drifted.

## Decision

**Make the import static**, matching both siblings. This removes the exposure
instead of widening the budget: the dist load moves to collection, which no
per-test timeout governs. Measured effect on the file: **457 ms → 12 ms**.

**Also align the three connector configs** on `testTimeout` / `hookTimeout:
30_000`. This is justified purely as consistency with the other 25 packages —
*not* on the grounds that `generic-cli` and `shared` share the failure mode.
They do not: their dist imports are already static, so a per-test budget was
never in the path. It is insurance for future slow tests there, nothing more.

Not chosen: a per-test timeout override in `public-export.test.ts`. It would fix
the symptom, leave the drift, and make the file inconsistent with every other
test in the repo, which relies on the config-level value.

Deferred, not addressed: the duplication itself. This change adds three more
hand-maintained copies of the same pair (29 instead of 26). The root-cause fix
is a shared `vitest.base.config.ts` the packages extend — a 28-file refactor
that does not belong in a flake fix.

## Honest limits of the evidence

**The flake could not be reproduced on demand.** Five consecutive
`pnpm turbo run test --force` runs passed, and a controlled attempt with 12 busy
loops on 10 cores did not reproduce it either (345 ms, well inside 5 s). CPU
contention alone is not the trigger; it takes the full workspace run.

That repro attempt was also weaker than it first looked: 12 busy loops is *pure
CPU* contention, while the real `turbo run test` adds 28 vitest worker pools, 28
in-process `tsc` typecheck runs, and the memory pressure that comes with them.
Failing to reproduce that way is close to no evidence either direction.

What *is* established, without a live repro:

1. The observed error names the mechanism exactly — `Test timed out in 5000ms`,
   a per-test budget expiring, not a hang or an assertion failure (and nothing
   in the graph can hang — see Cost below).
2. That budget is vitest's default, and this package was one of only three in
   the workspace that never overrode it.
3. The test was measurably close to it: ~450 ms of module-graph load charged to
   a 5 s budget, and that load is exactly what degrades under 28-way concurrency.
4. Both fixes are verified to move what failed. Static import: 457 ms → 12 ms
   for the file. Config budget: a 6 s test in this package fails with
   `Error: Test timed out in 5000ms.` at the old default and passes at the new
   one.

Claiming the flake is "confirmed gone" would need a reproduction this
investigation did not obtain — absence of the failure across subsequent runs is
weak evidence at a ~1-in-4-to-5 base rate. What can be said is that the cost
that was in the budget's path is no longer in it.

## Cost

A genuinely hung test in these three packages now takes 30 s to fail instead of
5 s. That is the same trade the other 25 packages already make. Ruled out for
this test specifically: nothing in the imported graph can hang. `dist/index.js`
has no top-level `await`, the transitive graph
(`connectors-shared → core → {context-gate, embeddings, output-filter, policy,
retrieval, stats, shared}`) is pure JS + zod, and the one heavy native
dependency is lazy — `packages/embeddings/dist/index.js:22` imports
`@huggingface/transformers` inside a function, so `onnxruntime-node` never loads
at module scope. The cost is transform-bound and degrades under concurrency
rather than unboundedly: slow, not hung.

## Noted in passing, not fixed

447 ms to import a 25 KB connector is a coupling smell — it pulls
`packages/core/dist/index.js` (185 KB) and the rest of the engine through
`connectors-shared` for a handful of constants and schemas. Barrel-export
coupling, worth its own ticket.
