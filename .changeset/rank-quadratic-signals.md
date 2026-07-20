---
"@megasaver/output-filter": patch
---

Bound three signal-extraction regexes that were quadratic on delimiter-free
input. `EXCEPTION_NAME` and `FILE_PATH` in `rank.ts` and `POSITION` in
`normalize.ts` each paired an unbounded greedy run with a required trailing
literal, so on a long run of characters the run's class accepts but the literal
never follows, every position started a scan to end-of-input and then
backtracked — O(starts x length).

Measured on 50 KB of a single repeated character: 6.6 s, 8.1 s and 7.4 s
respectively, and 6.1 s on realistic path-shaped text (`"a/b-c".repeat(10_000)`).
After bounding: 9.9 ms, 130 ms and 126 ms. `scoreChunk` on that input drops from
19.5 s to 188 ms.

This is reachable from ordinary tool output, not only crafted input: base64
blobs, minified bundles and hex dumps are long delimiter-free runs, and this
pipeline ingests arbitrary command output with no size cap ahead of it. It was
making `apps/cli`'s `saver-run` suite take 236 s and time out one test, which
left `main` red.

No behavior change: the bounds are far above any real exception name, file path
or source position, and the existing suites plus four added signal-detection
assertions confirm the same inputs still score identically. The bounds are
load-bearing — restoring `*` or `+` restores the quadratic.
