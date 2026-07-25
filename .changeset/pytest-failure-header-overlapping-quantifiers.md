---
"@megasaver/output-filter": patch
---

Collapse the trailing `\s+` in pytest's `FAILURE_HEADER` to a single `\s`. Ninth
instance of the unbounded-run class documented in
`wiki/concepts/unbounded-run-redos.md`, and the first with no bound to revert —
the cost comes from an ambiguity between adjacent quantifiers, not from an
unbounded class.

`/^_+\s+\S.*\s+_+$/` lets `.*` and the `\s+` behind it compete for the same
whitespace, and the `_+$` they hand off to cannot succeed on a line ending in
anything else. Every split point of `.*` inside a whitespace run therefore
rescans that whole run: O(N^2) in line length.

The gate is what makes it reachable. `detectPytest` is the **first** dispatch in
`chunkByFormatWithMeta` and fires on any text containing a `=== FAILURES ===`
line, so one padded line anywhere in a tool output or a read file routes every
remaining line of that text through the header pattern. Nothing upstream caps
size, and the vitest compressor that runs earlier leaves the line intact.

Measured in `parsePytest`'s per-line loop on `'_ x' + ' '.repeat(n) + 'y'`:

| input | before | after |
|-------|--------|-------|
| 25 KB | 247.6 ms | 0.1 ms |
| 50 KB | 979.1 ms | 0.1 ms |
| 100 KB | 3,899.0 ms | 0.1 ms |
| 200 KB | 16,152.9 ms | 0.2 ms |

~4x per doubling confirms the quadratic. Through `chunkByFormatWithMeta` at
200 KB: 18,805 ms → 3 ms. The interior underscore run in the original report is
not the driver — the pure whitespace shape above is the worst case; a long
underscore run with no whitespace costs 0.27 ms at 100 KB and a real
`___ test_broken ___` header 0.07 ms.

`\s` accepts exactly the same lines as `\s+` here, because `.*` already absorbs
any extra whitespace ahead of it: 0 mismatches over 400k random strings drawn
from `_`, space, tab, `x`, `.`, `y`, and identical verdicts on real pytest
headers, parameterised headers and near-miss shapes (`_ x_`, `_x _`, `_ _`,
`___ test_a ___ trailing`).

The regression guard runs at 200 KB rather than the suite's shared 100 KB: each
backtrack step here is a whitespace rescan with no class test, so once JIT-warm
the ambiguous form measured 5.0 s at 100 KB — level with the shared 5 s ceiling.
It was verified to fail on its own with the fix reverted (18,805 ms against the
5 s ceiling).
