---
"@megasaver/output-filter": patch
---

Bound the five remaining `^\s*`/`^\s+`-under-`m` leading runs in this package:
`TEST_FAILURE` (`rank.ts`), `FAIL_LINE` (`parsers/go-test.ts`), `SUMMARY` and
`PROBLEM_ROW` (`parsers/eslint.ts`), and `SIGNATURE` (`parsers/test-output.ts`).
Seventh instance of the unbounded-run class, and the siblings the sixth fix
missed — that one bounded `classify.ts`'s two copies of this exact shape and
stopped one file short.

The driver is a run of U+2028 LINE SEPARATOR (U+2029 is identical). Under `m`,
`^` anchors after every U+2028 **and** `\s` matches it, so each of these
patterns rescans the whole remaining run from every one of those anchors —
O(starts x length).

The pipeline's pre-filter does not shield them: `normalize` splits on `\n` only
and `collapseRepeatedLines` folds identical `\n`-lines, so the run arrives as a
single logical line with every anchor intact. `readRaw`
(`packages/context-gate/src/read.ts`) reads a file whole with no size cap and
hands it to `filterRaw` → `filterOutput`, so one file read carries the whole
cost. A plain `\n` run folds to a marker and a space/tab run leaves a single
anchor — neither fires, which makes U+2028/U+2029 crafted input rather than the
accidental shapes behind instances 6 and 7.

Measured through the real call sites at 200 KB, one bound reverted at a time
with the other four in place: 30.5 s (`detectGoTest`), 29.9 s (`detectEslint`,
`SUMMARY`), 30.0 s (`detectEslint`, `PROBLEM_ROW`), 30.7 s
(`detectTestOutput`), 33.5 s (`scoreChunk`) — so every bound is individually
load-bearing. All five bounded, the 28-test regression file runs in 200 ms.
Quadratic, so smaller inputs still hurt — 0.5 s at 25 KB, 1.9 s at 50 KB,
7.6 s at 100 KB.

Isolating `PROBLEM_ROW` takes care: `detectEslint` is
`SUMMARY.test(text) && PROBLEM_ROW.test(text)`, so on a bare run `SUMMARY`
fails and short-circuits before `PROBLEM_ROW` is evaluated. The guard prefixes
a real `✖ 3 problems` line so the `&&` reaches the second pattern.

Bounding the leading run is also what defuses `PROBLEM_ROW`'s second `\s+`: a
start position must now sit within 64 characters of the `\d+:\d+`, so only
O(64) starts can reach any one gap.

The bounds cost no reach. Under `m`, `^` re-anchors at every line, so an indent
match that spanned a line terminator was already reachable from the later
anchor; behavior can only diverge past 64 leading whitespace characters on one
physical line. Real go, eslint and vitest reporters indent by 1-6.
