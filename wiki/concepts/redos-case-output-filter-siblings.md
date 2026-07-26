---
title: "ReDoS case: instance 9, the five siblings instance 7 left behind"
tags: [concept, redos, case-study, output-filter, regex]
sources: [packages/output-filter/src/rank.ts, packages/output-filter/src/parsers/go-test.ts, packages/output-filter/src/parsers/eslint.ts, packages/output-filter/src/parsers/test-output.ts]
status: active
created: 2026-07-26
updated: 2026-07-26
---

# Instance 9: the five siblings instance 7 left behind

Case study for [[concepts/unbounded-run-redos]].

[[concepts/redos-case-output-filter]]'s instance 7 bounded the `^\s*`-under-`m`
shape in `classify.ts` and stopped there. Five more members of that exact shape
were sitting in the same package, untouched:

| pattern | file |
|---------|------|
| `TEST_FAILURE` `/^(?:FAIL\|\s*[✗×])\s\|…/im` | `rank.ts` |
| `FAIL_LINE` `/^\s*--- FAIL:/m` | `parsers/go-test.ts` |
| `SUMMARY` `/^\s*✖ \d+ problems?/m` | `parsers/eslint.ts` |
| `PROBLEM_ROW` `/^\s+\d+:\d+\s+(?:error\|warning)\s/m` | `parsers/eslint.ts` |
| `SIGNATURE` `/^(?:PASS\|FAIL)\s\|^\s*[✓✗×]\s\|…/m` | `parsers/test-output.ts` |

All five bounded to `{0,64}`/`{1,64}`, same as instance 7.

## The driver is crafted, not accidental

Instance 7's newline driver does **not** reach these, and that is why the sweep
that found 7 stopped: on the `filterOutput` path, `collapseRepeatedLines` folds a
`\n` run to a marker, and a space/tab run leaves a single anchor. The shape that
survives the pre-filter is a run of **U+2028 LINE SEPARATOR** (U+2029 identical):
`normalize` splits on `\n` only, so a U+2028 run arrives as one logical line —
yet under `m` every U+2028 is still a `^` anchor, and `\s` matches it. Every
anchor rescans the whole remaining run.

So unlike instances 6 and 7, this one needs crafted input. It still lands
through a normal path: `readRaw` (`context-gate/src/read.ts:148`) reads a file
whole with **no size cap** and hands it to `filterRaw` → `filterOutput`, so a
single read of a poisoned file pays the whole cost.

A **trailing non-whitespace character is required** for the driver to work.
`normalize` trimEnds every `\n`-line, and ES `\s` (hence `trimEnd`) includes
U+2028, so a run at end-of-line is stripped entirely. Same trap as instance 3's
`\s+$` driver — the guard test asserts
`collapseRepeatedLines(normalize(run))` still has full length, so a future
pre-filter change that folds U+2028 cannot silently make the ceilings pass for
the wrong reason.

## Measurements

One bound reverted at a time, other four left in place, 200 KB through each
real call site: 30.5 s (`detectGoTest`), 29.9 s (`detectEslint`/`SUMMARY`),
30.0 s (`detectEslint`/`PROBLEM_ROW`), 30.7 s (`detectTestOutput`), 33.5 s
(`scoreChunk`). All bounded: the 28-test guard file runs in 200 ms.

Isolating `PROBLEM_ROW` needs care: `detectEslint` is
`SUMMARY.test(text) && PROBLEM_ROW.test(text)`, so on a bare run `SUMMARY` fails
and short-circuits before `PROBLEM_ROW` is ever evaluated. The guard prefixes a
real `✖ 3 problems` line so `SUMMARY` matches at offset 0 for free and the `&&`
reaches the second pattern. Without that prefix `PROBLEM_ROW`'s bound is
untested and its reversion stays green.

Bounding the leading run is also what defuses `PROBLEM_ROW`'s *second* `\s+`: a
start position must now sit within 64 chars of the `\d+:\d+`, so only O(64)
starts can reach any one gap — linear. No second bound needed.

## Why they survived

Not a wiki-index problem this time (instance 6's cause) and not a public-entry
problem (instance 7's). The sweep for instance 7 grepped the shape, found it in
`classify.ts`, fixed what its driver could prove, and never asked whether the
same grep had other hits. Instance 7's own driver could not reach them, so a
"fixed, tests green" verdict looked complete.

**Rule:** when a fix bounds a pattern shape, grep the whole repo for that shape
and enumerate every hit in the same change — then, for each hit the current
driver cannot reach, find the driver that does or record in the page why the
hit is unreachable. A green test on one member is not evidence about its
siblings.

Two hits were enumerated and deliberately left alone: `compress/vitest.ts:6`
`PASSING` `/^\s*[✓√]\s/` has **no `m` flag** and is applied per `\n`-split line,
so `^` gives one anchor and the scan is linear; `memory-graph/src/parse-wiki.ts`
`/^\s*-\s+/` is likewise unflagged and per-line.

## Related

- [[concepts/unbounded-run-redos]] — the registry.
- [[concepts/redos-case-output-filter]] — instance 7, the sweep that missed these.
- [[concepts/redos-growth-ratio-measurement]] — this instance corrected the
  min-of-trials rule and forced the 4x size step.
