---
title: "ReDoS cases: output-filter (instances 7, 8, 9-pytest)"
tags: [concept, redos, case-study, output-filter, regex]
sources: [packages/output-filter/src/classify.ts, packages/output-filter/src/normalize.ts, packages/output-filter/src/parsers/pytest.ts]
status: active
created: 2026-07-26
updated: 2026-07-26
---

# ReDoS cases in `@megasaver/output-filter`

Case studies for [[concepts/unbounded-run-redos]]. Instances 2 and 3 (the five
signal regexes) are written up on [[entities/output-filter]]; instance 9's
five `^\s*` siblings have their own page,
[[concepts/redos-case-output-filter-siblings]].

## Instance 7: the `^\s*`-under-`m` variant

`\s` matches `\n`, so an `^\s*`-led alternative under `m` re-scans the whole
remaining whitespace region from every line start of a blank-line block: 31.8 s
through `classifyOutput` on 100 KB of newlines. The bound (`\s{0,64}`) costs no
reach — `^` re-anchors at every line, so an indent match that spanned a newline
was already reachable from the later line start.

Its exposure differs from instances 1-6: `classifyOutput` is a **public export
that only normalizes, never collapses**. `filterOutput` feeds it
post-`collapseRepeatedLines` text, which defuses the driver; `mega bench`
(`apps/cli/src/commands/bench.ts`) passes raw command output and had no such
shield. Second lesson, alongside the guard-size one: check what the *public*
entry point does, not what the internal caller happens to do first.

## Instance 8: `normalize`'s trailing-whitespace strip

Zero-width-literal variant of the shape: the required literal is an **anchor**,
not a character. `/\s+$/` on a whitespace run that is not at end-of-line
backtracks the whole run at every offset. It is the earliest instance in the
pipeline — `normalize` is the first structural pass over every raw tool output
and file read, ahead of any size cap (redaction runs first, then normalize).

Fixed by `String.prototype.trimEnd()`, which is exactly equivalent (ES `\s` is
WhiteSpace + LineTerminator, the identical set `trimEnd` removes; `$` without
`m` anchors only at end of string) and linear. Measured through the public
`classifyOutput`: 200 KB space run 13,846 ms → <1 ms; 200 KB tab run 17,046 ms →
<1 ms (source: `packages/output-filter/src/normalize.ts`).

The guard needed **2x** the suite's shared 100 KB. Each backtrack step here is a
bare anchor check, cheaper per step than the class/literal patterns, so at 100 KB
the unbounded form cost only 3.2-4.0 s and sat under the shared 5 s ceiling. Same
lesson as [[concepts/redos-guard-testing]], one level sharper: the ceiling
separates only if the size is tuned to the *per-step* cost of the specific
pattern, not to the class.

## Instance 9: pytest's failure-header banner

Overlapping-runs variant, and the first one with **no bound to revert**:
`/^_+\s+\S.*\s+_+$/` (`packages/output-filter/src/parsers/pytest.ts:4`). `.*` and
the `\s+` behind it both accept whitespace, and the `_+$` they hand off to cannot
succeed on a line ending in anything else, so every split point of `.*` inside a
whitespace run rescans that run.

The gate is what makes it reachable: `detectPytest` is the **first** dispatch in
`chunkByFormatWithMeta`, and it fires on any text containing a
`=== FAILURES ===` line — so one padded line in any tool output or file routes
every remaining line through the header pattern. Nothing upstream caps size, and
the vitest compressor that runs first leaves the line intact.

Fixed by collapsing the trailing `\s+` to a single `\s` — `.*` already absorbs
the extra whitespace, so the two forms accept exactly the same lines (0
mismatches over 400k random strings from `_ \tx.y`, and identical on real pytest
headers). Measured in `parsePytest`'s per-line loop: 247.6 / 979.1 / 3,899.0 /
16,152.9 ms at 25 / 50 / 100 / 200 KB → 0.1 / 0.1 / 0.1 / 0.2 ms. Through
`chunkByFormatWithMeta` at 200 KB: 18,805 ms → 3 ms.

The underscore run in the reporter's shape is not the driver — `'_ x' +
' '.repeat(n) + 'y'` with zero interior underscores is the worst case. Long
underscore runs *without* whitespace (0.27 ms at 100 KB) and real headers
(0.07 ms) never fire it.

## Related

- [[concepts/unbounded-run-redos]] — the registry.
- [[concepts/redos-case-output-filter-siblings]] — the five `^\s*` siblings.
- [[entities/output-filter]] — instances 2 and 3.
