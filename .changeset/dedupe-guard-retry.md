---
"@megasaver/output-filter": patch
---

Add `retry: 3` to the dedupe growth-ratio guard, which was the only timing guard
in the repo without it.

It went red once on ubuntu-latest at `3.178` against a `2.75` threshold, on a
DOCS-ONLY PR (#305), while windows-latest passed the same commit.

The threshold, trial count, and sizes are unchanged. Re-measured through the
guard's own harness (node v25.8.2, 10 cores, 5 repeats): linear reads 1.999-2.024
idle and 1.838-2.104 at 2x core oversubscription — uniform load does not move the
ratio, both samples inflate together — while a restored all-pairs scan reads
3.916-3.992 at ~18 s per full sample.

The retry cannot mask the defect, and that is verified rather than argued: with
the all-pairs scan restored AND the retry active, the guard failed on all four
attempts (3.929 / 3.897 / 3.831 / 3.885) — the lowest still 1.39x the threshold.

Deliberately NOT converted to a wall-clock ceiling. This guard shipped with a 5 s
ceiling and was moved off it two commits ago with measurements showing only a
1.4x margin to the reverted cost — a faster machine or a cheaper BigInt path
would green it with the quadratic restored. That silent-green failure is worse
than a visible flake.

The 3.178 itself is NOT diagnosed: CPU contention is ruled out, and the remaining
hypotheses (memory pressure on a 2-core runner, or interference spanning the
whole measurement window, which `min`-of-3 cannot filter) are unconfirmed. This
is a bounded, documented mitigation, not a root-cause fix.
