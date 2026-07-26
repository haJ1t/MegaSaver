---
title: Unbounded-run ReDoS (recurring defect class)
tags: [concept, redos, performance, regex, output-filter, policy, context-gate, memory-graph]
sources: [packages/output-filter/src/rank.ts, packages/output-filter/src/normalize.ts, packages/output-filter/src/classify.ts, packages/output-filter/src/parsers/stacktrace.ts, packages/output-filter/src/parsers/pytest.ts, packages/output-filter/src/parsers/go-test.ts, packages/output-filter/src/parsers/eslint.ts, packages/output-filter/src/parsers/test-output.ts, packages/policy/src/redaction-patterns.ts, packages/context-gate/src/session-hints.ts, packages/memory-graph/src/parse-wiki.ts, packages/indexer/src/extract/extract-json.ts]
status: active
created: 2026-07-20
updated: 2026-07-26
---

# Unbounded-run ReDoS

Several incidents in this repo share one defect shape — treat it as a class, not
unrelated bugs. **This page is the registry**: the shape, why it recurs, and the
instance index. Measurements and post-mortems live on the linked case pages.

## The shape

> An unbounded greedy run over a permissive class, followed by a required
> literal, evaluated at every start position.

On input the class accepts but the literal never follows, every start position
scans to end-of-input and backtracks: O(starts x length). Named variants seen
(ordinals dropped — the old "third variant"/"fourth variant" headings disagreed
with this list):

- **Class/literal** — `[A-Za-z]*Error`, `[\w./-]+\.\w{1,5}`, `eyJ[A-Za-z0-9_-]+\.`.
- **Overlapping runs** — `\s+at\s+.+`, where two adjacent quantifiers both
  accept whitespace, so the split between them is ambiguous at every offset.
  Same cost, but it fires on whitespace, which the delimiter-free probes miss.
- **Zero-width literal** — `\s+$`, where the required follower is an anchor
  rather than a character. Cheapest per backtrack step, so it needs a longer
  input than the others to clear the same timing ceiling (instance 8).
- **Line-anchored run under `m`** — `^\s*…`, where `\s` matches `\n`, so every
  line start inside a whitespace block is a fresh start position (instance 7).
- **Self-delimiting class** — `\[\[[^\]]+\]\]`, where the class accepts the
  opening delimiter of its own literal (instance 9, memory-graph).

## Why this repo keeps hitting it

The pipeline ingests arbitrary tool output with **no size cap ahead of it**, and
the triggering shapes are ordinary, not crafted: base64 blobs, minified bundles,
hex dumps (delimiter-free runs); column-padded tables and tab-indented logs
(whitespace runs).

## Instances (all fixed)

| # | Where | Write-up |
|---|-------|----------|
| 1 | `jwt` redaction detector, `packages/policy` | [[entities/policy]] (own spec + security-reviewer chain) |
| 2 | `EXCEPTION_NAME`, `FILE_PATH`, `POSITION` — output-filter | [[entities/output-filter]], `8a872ef2` |
| 3 | `STACKTRACE` (`rank.ts`), `SIGNATURE` (`parsers/stacktrace.ts`) | [[entities/output-filter]], `a1bf5983` |
| 4 | `email` observer, `redaction-patterns.ts` | [[concepts/redos-case-policy]] |
| 5 | 3 lookbehind patterns, `redaction-patterns.ts` | [[concepts/redos-case-policy]] |
| 6 | `FILE_PATH`, `context-gate/src/session-hints.ts:17` | [[concepts/redos-case-context-gate]] |
| 7 | `VITEST_OUT`, `PROSE_ANTI_VI` (`classify.ts`) | [[concepts/redos-case-output-filter]] |
| 8 | `/\s+$/` trailing-whitespace strip, `normalize.ts:10` | [[concepts/redos-case-output-filter]] (`trimEnd()`) |
| 9 | `FAILURE_HEADER`, `parsers/pytest.ts:4` | [[concepts/redos-case-output-filter]] |
| 9 | `TEST_FAILURE` (`rank.ts`), `FAIL_LINE` (`go-test.ts`), `SUMMARY` + `PROBLEM_ROW` (`eslint.ts`), `SIGNATURE` (`test-output.ts`) | [[concepts/redos-case-output-filter-siblings]] |
| 9 | citation anchor strip, `memory-graph/src/parse-wiki.ts:79` | [[concepts/redos-case-memory-graph]] |
| 9 | wikilink scanner, `memory-graph/src/parse-wiki.ts:64` | [[concepts/redos-case-memory-graph]] |
| 10 | `email`, `aws_secret_key`, `api_key_header`, `basic_auth_header`, `db_url`, `url_basic_auth`, `private_key_block` | [[concepts/lookahead-start-guard]] (2026-07-25) |

## Fixing it: four moves, chosen by measurement

- Bound the run — for an unbounded forward run before a required literal.
- Left-boundary lookbehind — see the `jwt` fix on [[entities/policy]].
- [[concepts/lookahead-start-guard]] — for a variable-length lookbehind re-walked
  at every offset. Provably lossless and 60-80x faster than bounding the same run
  (measured: `aws_secret_key` 0.1 ms against 8.1 ms bounded), but
  position-sensitive and engine-dependent. It superseded a bound-based fix for
  the same three patterns; both worked, the guard costs less and loses nothing.
- Fourth move, when a trailing `.trim()` or an end-anchored tail already makes
  the run irrelevant: **delete the quantifier** rather than cap it (instance 8's
  `trimEnd()`, the memory-graph anchor strip). No magic number left to justify.

How to test any of them: [[concepts/redos-guard-testing]] and
[[concepts/redos-growth-ratio-measurement]]. Every rule there was paid for by a
suite that passed while broken.

## Not this class

- `compileGlob` (`packages/policy`, [[concepts/glob-compile-redos]]) — exponential
  in 2026-07, but the regex there is *built from* untrusted input rather than
  applied to it, so a bound-the-run patch does nothing.
- `extractJson`'s `lineOf` (`packages/indexer`, [[entities/indexer]], fixed
  2026-07-25) — same *cost curve*, no backtracking: one regex compiled per key
  and all lines rescanned for each, O(keys x lines). Hostile strings find
  nothing; an ordinary flat dictionary is the trigger. Sweep for "regex inside a
  per-item loop over all lines", not only for ambiguous quantifiers.

## Related

Case pages are linked from the instance table above.

- [[concepts/redos-guard-testing]] — how to fence a fix so it stays fixed.
- [[concepts/redos-growth-ratio-measurement]] — the n-vs-kn instrument.
- [[concepts/glob-compile-redos]] — the sibling defect class.
- [[entities/output-filter]], [[entities/policy]], [[entities/context-gate]],
  [[entities/indexer]].
