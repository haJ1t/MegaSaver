---
risk: MEDIUM
status: implemented
source: windows-latest red on PR #299 at a commit that had passed an hour earlier
---

# ReDoS guard determinism — design

## Problem

`packages/context-gate/test/session-hints-redos.test.ts` guards the `FILE_PATH`
ReDoS bound with a **growth ratio**: it samples `extractFailureSignatures` at
2 KB and 4 KB and asserts the ratio is `< 2.5x`.

On windows-latest it measured **4.12x** and failed — on a commit whose identical
tree had passed the same job forty minutes earlier. Re-running the job passed.

The gate does not have room to work. Bounded measures ~2.0x, so the whole
assertion lives inside a 25% band, sampled off ~60 ms measurements on a shared,
noisy CI runner. `min`-of-5 is taken over per-trial *ratios*, which only helps
when some single trial has both samples clean — it does nothing when the large
sample is contended in every trial the small one is not.

A security regression test that cries wolf is worse than no test: it trains
everyone to re-run without reading, which is precisely how the real regression
would get waved through.

## Decision

Replace the ratio with an **absolute ceiling**, matching what both sibling
suites already do.

Measured at the shipped 4 000-char cap, per shape:

| shape | bounded | bound reverted |
|---|---|---|
| single repeated character | 1.9 ms | 12–21 s |
| hex-dump run | 2.1 ms | 12–19 s |
| underscore/digit run | 2.1 ms | 12–22 s |

~6 000x separation. `CEILING_MS = 1_000` is placed against the **tail**, not the
median: a cold first call was observed at 73.8 ms and warm calls spike to
12–21 ms under load, so the real green margin is ~13x here and ~4x on a
windows-latest runner (~3x slower at this workload), while a reverted bound
overshoots by 12–22x. `retry: 3` — matching `policy/glob-redos.test.ts` — covers
what is left; at this separation a retry cannot mask a regression, because a
reverted bound is over on every attempt.

The file's original comment argued *against* a ceiling, citing a suite where
four of five reverted bounds slipped under a 5 s ceiling at 50 KB. That
objection is about a case where the reverted form was genuinely fast at the size
probed. It does not survive a 6 000x gap, and the numbers above are per-shape
measurements rather than an extrapolation.

Prior art in this repo cuts the other way as well:
`packages/output-filter/test/rank-redos.test.ts` **tried a scaling ratio first
and rejected it**, measuring the bounded ratio at 1.48–3.78 over 12 runs. A 2.5x
threshold sits inside that band. Both siblings (`rank-redos`,
`policy/glob-redos`) settled on a ceiling. This file was the outlier;
windows-latest found the seam.

## Consequences

The calibration loop, repeat count, trial loop and `min`-of-ratios statistic all
go — a ceiling this far from either outcome needs none of them. The suite drops
from ~1.5 s to 9 ms in the green path.

The RED path stays honest: one call per shape, so a reverted bound fails on the
ceiling in ~20 s reporting the real measurement, rather than multiplying a 20 s
call by a repeat count inside a loop vitest cannot interrupt (its `timeout` only
fires at async boundaries) and surfacing as a bare timeout with no number in it.

What is given up: a ceiling cannot catch a *modest* slowdown, only the
catastrophic one. That is the same trade `rank-redos` documents, and here the
mitigation is concrete rather than hand-waved.

The narrowest regression is not the full revert but the `+` restore
(`{0,255}\w+\.`, outer bound kept), which costs 1.9–3.0 s — only ~2–3x over the
ceiling, a margin a much faster machine could close. That case does not rest on
the ceiling: it also fails the 256-char clip assertion at the bottom of the
file, in **2 ms**, deterministically and independent of hardware. The clip
assertion pins the bound, so the only bound-preserving regression left is the
`+` restore, and that one is caught without a stopwatch. The two halves are a
pair; neither is sufficient alone.

Verified: with `{0,255}\w+\.` in place, both the ceiling (1931/1917/3028 ms)
and the clip assertion go red.

## Out of scope

`packages/connectors/claude-code/test/public-export.test.ts` fails roughly 1 in
4-5 full concurrent runs on a 5 s budget while dynamically importing a large
freshly-built bundle. Same defect class — a load-sensitive timing assumption —
but a different package and predating this change (observed on unrelated
branches). Filed separately.
