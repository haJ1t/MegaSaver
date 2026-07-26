---
title: Measuring superlinear growth in a ReDoS guard
tags: [concept, redos, testing, performance, measurement]
sources: [packages/context-gate/test/session-hints-redos.test.ts, packages/output-filter/test/dedupe-quadratic.test.ts, packages/memory-graph/test/parse-wiki-redos.test.ts]
status: active
created: 2026-07-26
updated: 2026-07-26
---

# Measuring superlinear growth in a ReDoS guard

The instrument half of [[concepts/redos-guard-testing]]: how to build an n-vs-kn
growth-ratio assertion, and when not to. Every rule here corrects a shipped guard.

## First choice is still a ceiling at a large enough size

A ratio is a fallback, not the default. Under a 55-task parallel `turbo` run the
instance-9 anchor-strip guard read **15.9x and 12.6x** — squarely in quadratic
territory — while the same code measured 2-4x idle and passed 79/79 in isolation.
min-of-trials does not save it: it cancels *spikes*, and sustained load is not a
spike. Every trial is slow, and the larger sample accumulates more preemption
than the smaller one, so the ratio inflates even though both sides are linear.

Raising the input size until the defect alone decides the verdict is the fix.
Both memory-graph guards and the context-gate guard (`0e8f3362`, PR #301) now do
that: at 200 KB the bounded form costs 0.1-0.2 ms and the reverted forms cost
4.7-34 s, so a ceiling of 250 ms sits ~1,250x above the slowest green and 19x
below the fastest red. Five orders of magnitude of separation is not
load-dependent in any way that matters; a ratio with 2x of headroom is.

**Use a growth ratio only where the size cannot be raised enough to buy that
separation — and never in a suite that runs under `turbo`'s full fan-out.**

## Minimise per SIZE, then divide — never the per-trial ratio

Scheduler noise can only inflate a duration, so **minimise across trials, never
average** — a mean carries every spike into the verdict. *What* to minimise was
wrong twice. `min(large_i / small_i)` pairs a noise-inflated `small`
with a clean `large` and reports a **fraction** of the true growth — biased
toward false green. Minimise each size independently and divide: both minima
converge on their true cost from above, so the quotient converges on the true
ratio.

Two reproductions of the bias, both on real reverted code:

| guard | min-of-ratios | min-per-size |
|-------|---------------|--------------|
| `dedupe()` reverted (`output-filter`) | 2.55x | 4.48x |
| instance 9 anchor strip, loaded machine | 2.94x | 7.63x |

Instance 6's ~5.5x separation absorbs the bias; a ~2x separation does not — the
first cut of the instance-9 test passed against the unfixed code.

## Sizing the two samples

- **A 4x size step, not 2x**, where no shipped cap fixes the size. Linear then
  predicts 4.0 and the defect measured 12.7-18.5x, so a threshold of 8 leaves
  ~2x margin on both sides. At 2x the bands are 2.0 vs 4.1 — too close to
  survive a busy runner.
- **Calibrated repeat count, not a fixed one.** Vitest cannot interrupt a
  synchronous loop — `timeout` only fires at async boundaries, so a fixed repeat
  count multiplies the pathological cost and hangs for 17+ minutes instead of
  going red. Deriving the count from one real call spends ~60 ms per sample when
  bounded and drops to a single repeat when not.
- **An explicit per-test timeout.** The quadratic form needs ~70 s to produce its
  own red; with the file's 30 s default the revert check fails on a timeout
  instead of on the assertion, which proves nothing about the ratio.

Worked example, instance 6's guard
(`packages/context-gate/test/session-hints-redos.test.ts`): samples the real
function at n and 2n, fails above 2.5x; bounded is linear (~2.0x), the defect
measured 5.4-5.7x. A single un-minimised trial hit 2.91x under four busy cores;
the min over 5 trials stayed at 1.09-1.94x idle and loaded. An earlier attempt at
a ratio failed because the unbounded form measured only 1.81x — never separated.

## One shape does not separate every bound

Reverting each of instances 4-5's four bounds alone showed the ratio guard is
**per-shape**, not per-function: `aws_secret_key` reverted goes red only on a
space run (3.77x) while the tab run stays green — and `api_key_header` reverted
is the exact mirror, red on tabs (3.89x), green on spaces. On the shape it does
not separate, the reverted pattern still burns 65–100 s at these sizes and the
assertion passes anyway. Carry one shape per member of the whitespace class, and
revert each bound individually to find out which shape is the one that catches it.

## Quote a reproduction, not an estimate

The `dedupe()` guard (`packages/output-filter/test/dedupe-quadratic.test.ts`)
shipped a 5 s ceiling documenting the reverted cost as 13.5 s in the test and
17.4 s in its changeset; reproduction on the machine that wrote both gave
6.8-7.7 s — a 1.4x margin. Rewritten as an n-vs-2n ratio at 64k/128k lines with a
2.75x threshold it reads 1.95-2.09x idle, 2.06-2.17x under four busy cores, and
4.48x reverted. Both wrong numbers were plausible and neither had been re-run.
**A margin claim is only load-bearing if the revert was actually performed.**

## Related

- [[concepts/redos-guard-testing]] — the rest of the guard checklist.
- [[concepts/unbounded-run-redos]] — the defect class these guards fence.
