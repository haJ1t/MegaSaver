---
"@megasaver/output-filter": patch
---

Bound five signal-extraction regexes that were quadratic on long runs.
`EXCEPTION_NAME`, `FILE_PATH` and `STACKTRACE` in `rank.ts`, `POSITION` in
`normalize.ts` and `SIGNATURE` in `parsers/stacktrace.ts` each paired an
unbounded greedy run with a required trailing literal, so on a long run of
characters the run's class accepts but the literal never follows, every position
started a scan to end-of-input and then backtracked — O(starts x length).

`STACKTRACE` and `SIGNATURE` have a second driver on top of that: `\s+` and `.+`
both accept whitespace, so the split between them is ambiguous at every offset
of a long whitespace run, and `SIGNATURE`'s two `.+` runs are ambiguous again on
a paren-dense line.

Measured through each pattern's real call site on 100 KB of the input shape that
drives it, unbounded: `EXCEPTION_NAME` 16.1 s, `FILE_PATH` 19.3 s, `POSITION`
12.2 s, `SIGNATURE` 16.5 s, `STACKTRACE` 32.9 s. Bounded, the whole regression
suite covering all five runs in ~450 ms.

This is reachable from ordinary tool output, not only crafted input: base64
blobs, minified bundles and hex dumps are long delimiter-free runs, column-
padded tables and tab-indented logs are long whitespace runs, and this pipeline
ingests arbitrary command output with no size cap ahead of it. It contributed to
`apps/cli`'s `saver-run` suite timing out a test, which left `main` red.

No realistic input changes behavior, but the bounds are not free, so here is
exactly where each one bites:

- `EXCEPTION_NAME` diverges at 65 filler chars (`A` + 65 lowercase + `Error`).
  It cannot diverge if the filler contains an uppercase letter — any `[A-Z]`
  restarts the match.
- `POSITION` diverges at 257 filler chars drawn from `[\w./-]` but not
  `[A-Za-z]` (e.g. `-`). Alphanumeric filler cannot diverge, for the same
  restart reason.
- `FILE_PATH` cannot diverge at any length: its start class equals its
  continuation class, so a longer run simply starts the match later.
- `STACKTRACE` and `SIGNATURE` diverge past 512 body chars, and `STACKTRACE`
  past 64 indent chars. These two are `^`-anchored, so they have no restart
  escape. Verified equivalent on 20 real frames first: node with and without
  parens, tab-indented, deep monorepo, nested v8 eval, java, python, go, rust.

The bounds are load-bearing — restoring `*` or `+` restores the quadratic, and
the regression suite now fails on each one individually.

Correction to the original report: the `saver-run` baseline was first quoted as
236 s. That figure was captured under `turbo test` with ~12 packages in
parallel; on an idle machine the same suite measures 160 s. The red-to-green
result and the 50.8 s fixed figure reproduce as stated.
