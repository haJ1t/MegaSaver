# Connector test timeout — plan

Spec: [2026-07-25-connector-test-timeout-design.md](../specs/2026-07-25-connector-test-timeout-design.md)

1. Check whether turbo guarantees the build before the test task.
   → verify: read `turbo.json`.
2. Measure the dist import cost, first call and second.
   → verify: real numbers, to settle whether `beforeAll` hoisting would help.
3. Audit every vitest config in the workspace for `testTimeout`.
   → verify: count outliers.
4. Try to reproduce, idle and under induced load.
   → verify: honest result either way.
5. Add `testTimeout` / `hookTimeout: 30_000` to the three connector configs.
   → verify: a 6 s test fails at the old default and passes at the new one.
6. Spec + plan; `pnpm verify`.
7. Review, then address findings.

## Evidence

Step 1 — `turbo.json`: `"test": { "dependsOn": ["^build", "build"] }`. The
package's own build completes first, so this is **not** a partial-write race.

Step 2 — dist is 25 KB, not "a large bundle":

```
IMPORT first=205ms second=0.0ms
```

The second import is free (ESM module cache), so hoisting both calls into
`beforeAll` would gain nothing. Two of the three proposed fixes were wrong.

Step 3 — 25 of 28 vitest configs set `testTimeout: 30_000` + `hookTimeout:
30_000`. The three that do not:

```
NO testTimeout: packages/connectors/claude-code/vitest.config.ts
NO testTimeout: packages/connectors/generic-cli/vitest.config.ts
NO testTimeout: packages/connectors/shared/vitest.config.ts
```

Step 4 — **not reproduced.** Five consecutive `pnpm turbo run test --force`
runs passed. A controlled attempt with 12 busy loops on 10 cores also passed,
at 345 ms:

```
=== default 5s budget under load:  ✓ (2 tests) 345ms
=== 30s budget under same load:    ✓ (2 tests) 356ms
```

CPU contention alone is not the trigger. Recorded rather than papered over —
see the spec's "Honest limits of the evidence".

Step 5 — the fix is proven to move the budget that failed. A 6 s test in this
package:

```
--- at the OLD default (5s):   Error: Test timed out in 5000ms.
--- at the NEW config default: ✓ test/zz-timeout-probe.test.ts (1 test) 6003ms
```

The failure string matches the reported flake exactly. Probe file removed.

Step 6 — `pnpm verify` 56/56, exit 0; `pnpm turbo run test --force` 56/56.

## Review findings addressed

- **`generic-cli` and `shared` do NOT share the failure mode.** Their
  `public-export.test.ts` files use a static top-level
  `import * as pkg from "../dist/index.js"`, so the dist load is paid during
  collection, which no per-test budget governs. Measured: `shared` runs its
  tests in 1 ms with 214 ms in *collect*; `claude-code` ran 457 ms of *test*.
  The config comment and spec claimed "same exposure" — false, corrected. The
  two extra config edits stay, justified as consistency only.
- **The better fix was missed.** Rejecting the hoist on "second import is 0.0 ms"
  answered whether the *second* import costs anything, not whether the *first*
  belongs inside a timed test. Both siblings already import statically.
  `claude-code` now does too: **457 ms → 12 ms** for the file, and the cost
  leaves the per-test budget entirely rather than the budget growing around it.
- **A hang would make the timeout bump useless.** Checked: no top-level `await`
  in the graph, all pure JS + zod, and `@huggingface/transformers` is imported
  lazily inside a function so `onnxruntime-node` never loads at module scope.
  Slow, not hung — recorded in the spec.
- **"Every vitest config in the workspace" overstated it.**
  `scripts/conventions-sync/vitest.config.ts` is a fourth without the pair; it
  sits outside the workspace globs and never runs under `turbo test`. Scoped
  explicitly.
- **Config comments trimmed** from seven lines of volatile measurements to one
  line plus a spec pointer, and the duplication root cause (no shared base
  config) is now marked deferred rather than left dangling.

Making the import static then broke `tsc -p tsconfig.test.json`: with a dynamic
`await import()` the module was untyped, so the test's context literal was never
checked against the branded `ProjectId` and the agent-id union. Fixed by parsing
the literal through the package's own exported `ClaudeCodeContextSchema`, which
brands and narrows it — rather than the `ctx as never` cast the `generic-cli`
sibling uses. Validating the public surface with the public surface is what this
file is for, and it means the change removed a latent type hole as well.

## What this does and does not claim

Claimed: the ~450 ms module-graph load is no longer charged to a per-test
budget (457 ms → 12 ms), and the three connector packages no longer sit on a 5 s
budget the rest of the workspace abandoned. Both changes are verified effective.

Not claimed: that the flake is confirmed gone. That would need a reproduction
this investigation did not get, and with a ~1-in-4-to-5 base rate a handful of
green runs is not evidence.
