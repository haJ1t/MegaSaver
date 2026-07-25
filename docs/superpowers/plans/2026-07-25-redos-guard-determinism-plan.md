# ReDoS guard determinism — plan

Spec: [2026-07-25-redos-guard-determinism-design.md](../specs/2026-07-25-redos-guard-determinism-design.md)

1. Measure the bounded cost at the shipped cap for all three shapes.
   → verify: real numbers, not an estimate.
2. Revert the bound, measure the same three shapes.
   → verify: separation large enough that a ceiling is decided by the defect
   rather than the runner.
3. Replace the ratio gate with `elapsed(...) < CEILING_MS`, matching the sibling
   suites' helper; delete the calibration loop, trial loop and ratio statistic.
   → verify: green path passes and gets fast.
4. Revert the bound again with the new gate in place.
   → verify: **RED** on all three shapes, each reporting its real measurement.
5. Spec + plan; `pnpm verify`.
6. Review, then CI — windows-latest is the platform that exposed the flake.

## Evidence

Step 1 — bounded, at the 4 000-char cap, 20 calls each:

```
single repeated char: min=1.907ms median=2.109ms max=2.689ms
hex-dump run:         min=2.139ms median=2.627ms max=3.123ms
underscore/digit run: min=2.083ms median=2.432ms max=2.726ms
```

Step 2 — bound reverted to `[\w./\\-]*\w+\.`, single call each:

```
single repeated char: 17403ms
hex-dump run:         15019ms
underscore/digit run: 17335ms
```

~6 000x separation.

Step 4 RED — new ceiling gate, bound reverted:

```
× scans 4 KB of a single repeated character in under 1s   20192ms
× scans 4 KB of a hex-dump run in under 1s                18747ms
× scans 4 KB of an underscore/digit run in under 1s       22243ms
AssertionError: expected 20188.574167000002 to be less than 1000
AssertionError: expected 18746.642207999997 to be less than 1000
AssertionError: expected 22241.724833 to be less than 1000
```

The companion clipping assertion (`clips the leading run of an absurdly long
path`) goes red in the same run, as it should — it pins the bound's one
deliberate behavioural divergence.

GREEN: `session-hints-redos.test.ts` 16/16 in **9 ms**, down from ~1.5 s.
`pnpm verify` exit 0.

## Review findings addressed

Adversarial review found the change is not merely less flaky but **strictly
stronger**, and one thing to add:

- **The old ratio gate passed a real catastrophic regression.** With the `+`
  restored under the shipped 255 bound, the reviewer measured the old gate
  PASSING on 2 of 3 shapes (burning ~57 s doing it) while the new ceiling failed
  all 3. Both sizes are already deep in the superquadratic regime there, so the
  growth *looks* linear and the ratio is structurally blind to it. This refutes
  the deleted comment's "the unbounded form measured 5.4-5.7x here".
- **`retry: 3` added**, matching `policy/glob-redos.test.ts`. The stated ~500x
  headroom was median-only; the observed tail is a 73.8 ms cold call and 12-21 ms
  warm spikes, so real green margin is ~13x here, ~4x on windows-latest. At a
  6000x separation a retry cannot mask a regression.
- **The narrow case is documented and verified.** The `+` restore is only ~2-3x
  over the ceiling — a margin a faster machine could close. Confirmed it also
  fails the 256-char clip assertion in 2 ms, deterministically. The two halves of
  the file are a pair; the comment and spec now say so concretely instead of
  waving at "the behavioural assertions guard the rest".
- **Numbers loosened to what was actually observed** (12-22 s, not 15-22 s).

Also confirmed by review: with `--testTimeout=1000` forced, the RED path still
surfaces as `AssertionError: expected 15289.05 to be less than 1000`, not a
timeout — a synchronous body rejects before the timer macrotask runs. And
`packages/context-gate/vitest.config.ts:4` sets `testTimeout: 30_000`, so the
~20 s red path fits regardless.

## A false lead, recorded

Two `pnpm verify` runs failed on `@megasaver/connector-claude-code#test` while a
pristine `main` passed once — which looked like this change perturbing turbo's
scheduling by making the redos suite ~150x faster. It is not: two forced
uncached runs (`pnpm turbo run test --force`) passed with the change, the test
passes 128/128 in isolation, and the same failure was observed earlier on
unrelated branches. The three plain `pnpm verify` re-runs used to "confirm" it
were turbo **cache hits** and proved nothing — `--force` is required to
re-execute a cached test task. Filed as a separate pre-existing flake.
