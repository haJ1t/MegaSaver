---
"@megasaver/output-filter": patch
---

Bound the leading-indent runs in `classify.ts`'s `VITEST_OUT` and
`PROSE_ANTI_VI`, which were quadratic on a blank-line block. Sixth instance of
the unbounded-run class already fixed in `rank.ts`, `normalize.ts` and
`parsers/stacktrace.ts`, with a driver of its own: these patterns open three
(resp. two) alternatives with `^\s*` under the `m` flag, and `\s` matches `\n`,
so inside a run of blank lines every line start consumes the whole remaining
whitespace region before failing the required literal — O(starts x length).

Measured through the real call site, `classifyOutput` on 100 KB of newlines:
31.8 s before, 89 ms after. It is quadratic, so smaller inputs still hurt —
1.7 s at 25 KB, 6.6 s at 50 KB.

`classifyOutput` is a public export and only normalizes; it does not collapse.
`mega bench` (`apps/cli/src/commands/bench.ts`) hands it raw command output, so
a benchmarked command emitting a padded log tail, a truncated stream or blank
separators hung for tens of seconds. The `filterOutput` path was shielded only
incidentally, by feeding post-`collapseRepeatedLines` text.

Both bounds are load-bearing and both were needed: the prose check runs on text
that already got past the vitest check, so on the same input, reverting either
one alone takes the new 100 KB regression test to 32.6 s / 20.9 s.

The bound costs no reach. Under `m`, `^` re-anchors at every line, so an indent
match that spanned a newline was already reachable from the later line start —
behavior can only diverge on 65+ whitespace characters preceding
`Test Files` / `Tests` / `FAIL` / `PASS` on one physical line. Real vitest
reporters indent those by 1-6.
