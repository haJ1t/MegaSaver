---
"@megasaver/output-filter": patch
---

Gate the `dedupe()` regression guard on a growth ratio instead of a wall-clock
ceiling.

The guard shipped with a 5 s ceiling at 128k lines and claimed the reverted
all-pairs scan cost 13.5 s (its changeset said 17.4 s — the two never agreed).
Reproduced on the machine that produced both numbers, node v25.8.2, reverting
`dedupe()` measures 6.8 / 6.9 / 7.7 s: a 1.4x margin, not the 2.7x claimed. A
machine ~1.5x faster, or a cheaper BigInt path in a future Node, greens the
guard with the quadratic scan restored — the exact silent-green failure the
ceiling existed to prevent.

The guard now samples `filterOutput` at 64k and 128k lines and fails above
2.75x growth. Nothing in that constant is tuned to a machine: the all-pairs
scan is quadratic in chunk count so doubling the input costs it ~4x, while the
banded lookup is linear and costs ~2x, and load moves both samples together.
Measured: 1.95-2.09x idle and 2.06-2.17x under four busy cores with the fix in
place, 4.48x with it reverted.

Each side's minimum is taken across 3 trials before dividing, rather than
minimising the per-trial ratio. Noise can only inflate a duration, so a
per-side minimum converges on the noise-free cost; minimising the ratio instead
pairs an inflated 64k sample with a clean 128k one and biases the result down —
that form read 2.55 with the defect restored where this one reads 4.48.
