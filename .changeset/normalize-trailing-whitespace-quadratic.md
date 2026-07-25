---
"@megasaver/output-filter": patch
---

Replace `normalize`'s per-line trailing-whitespace strip `/\s+$/` with
`String.prototype.trimEnd()`. Sixth instance of the unbounded-run class already
documented in `wiki/concepts/unbounded-run-redos.md`, and the earliest one in
the pipeline: `normalize` is the first structural pass over every raw tool
output and file read, ahead of any size cap.

`\s+$` is an unbounded greedy run followed by a required (zero-width) anchor,
retried at every start position. On a whitespace run that is *not* at
end-of-line — a padded table row, an ASCII banner, a tab-indented blob, a
whitespace-padded minified file — each of the N offsets inside the run consumes
to the run's end, fails `$`, and backtracks the whole run: O(N^2) in line
length. A run that *is* at end-of-line matches on the second start position and
is linear, which is why the defect survived the existing corpus.

Measured through the public `classifyOutput({ text })`, which calls `normalize`
first, on `'a' + fill.repeat(n - 2) + 'b'`:

| input | before | after |
|-------|--------|-------|
| 100 KB space run | 3,208 ms | <1 ms |
| 100 KB tab run | 3,977 ms | <1 ms |
| 200 KB space run | 13,846 ms | <1 ms |
| 200 KB tab run | 17,046 ms | <1 ms |

Roughly 4x per doubling confirms the quadratic. A same-byte-count control that
wraps the identical whitespace at 80 columns measured 3.2 / 9.5 / 12.3 / 17.1 ms
at 25 / 50 / 100 / 200 KB against the single-line run's 1,329 / 6,958 / 8,614 /
23,122 ms, so the cost was the regex shape and not the byte count.

`trimEnd` is exactly equivalent, not an approximation: ES `\s` is defined as
WhiteSpace plus LineTerminator, which is the identical set `trimEnd` removes,
and `$` without the `m` flag anchors only at end of string — the same maximal
trailing run. A regression test pins the exotic members of that set (vertical
tab, form feed, NBSP, BOM).

The regression guard runs at 200 KB rather than the suite's shared 100 KB. Each
backtrack step here is a bare anchor check, cheaper per step than the
class/literal patterns already guarded, so at 100 KB the unbounded form stayed
under the shared 5 s ceiling. Both new cases were verified to fail on their own
when the fix is reverted (33.6 s / 29.6 s against a 5 s ceiling).
