## [2026-07-25] fix | unbounded-run-redos instance 9 (output-filter)

Bounded the five remaining `^\s*`/`^\s+`-under-`m` leading runs in
`@megasaver/output-filter` — `TEST_FAILURE` (`rank.ts`), `FAIL_LINE`
(`parsers/go-test.ts`), `SUMMARY` + `PROBLEM_ROW` (`parsers/eslint.ts`),
`SIGNATURE` (`parsers/test-output.ts`). Siblings the instance-7 fix left behind
when it bounded `classify.ts` and stopped there.

Driver is a U+2028/U+2029 run, which survives `normalize` +
`collapseRepeatedLines` (they only fold `\n`) while still anchoring `^` under
`m`. Reaches `filterOutput` through the uncapped `readRaw`. 200 KB, one bound
reverted at a time: 29.9-33.5 s each; all bounded, 200 ms.

Guard: `packages/output-filter/test/multiline-ws-anchor-redos.test.ts` (28
tests). Updated `concepts/unbounded-run-redos` — new instance 9 section, the
grep-every-hit rule, `sources:` frontmatter extended to the three parser files
plus `classify.ts`, and the `Related` line corrected (output-filter holds
2, 3, 7, 8, 9 — it read "2, 3 and 6", but 6 is the context-gate instance).
`pnpm verify` green, 56/56.
