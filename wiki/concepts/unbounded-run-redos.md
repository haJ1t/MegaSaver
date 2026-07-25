---
title: Unbounded-run ReDoS (recurring defect class)
tags: [concept, redos, performance, regex, output-filter, policy]
sources:
  - packages/output-filter/src/rank.ts
  - packages/output-filter/src/normalize.ts
  - packages/output-filter/src/parsers/stacktrace.ts
  - packages/policy/src/redaction-patterns.ts
status: active
created: 2026-07-20
updated: 2026-07-25
---

# Unbounded-run ReDoS

Several separate incidents in this repo share one defect shape. Treat it as a
class, not a handful of unrelated bugs.

## The shape

> An unbounded greedy run over a permissive class, followed by a required
> literal, evaluated at every start position.

On input the class accepts but the literal never follows, every start position
scans to end-of-input and backtracks: O(starts x length). Three variants seen:

- **Class/literal** — `[A-Za-z]*Error`, `[\w./-]+\.\w{1,5}`, `eyJ[A-Za-z0-9_-]+\.`.
- **Overlapping runs** — `\s+at\s+.+`, where two adjacent quantifiers both
  accept whitespace, so the split between them is ambiguous at every offset.
  Same cost, but it fires on whitespace, which the delimiter-free probes miss.
- **Zero-width literal** — `\s+$`, where the required follower is an anchor
  rather than a character. Cheapest per backtrack step, so it needs a longer
  input than the others to clear the same timing ceiling (instance 6).

## Why this repo keeps hitting it

The pipeline ingests arbitrary tool output with **no size cap ahead of it**, and
the triggering shapes are ordinary, not crafted: base64 blobs, minified bundles,
hex dumps (delimiter-free runs); column-padded tables and tab-indented logs
(whitespace runs).

## Instances

| # | Where | Status |
|---|-------|--------|
| 1 | `jwt` redaction detector, `packages/policy` | fixed (own spec + security-reviewer chain) |
| 2 | `EXCEPTION_NAME`, `FILE_PATH`, `POSITION` — output-filter | fixed, `8a872ef2` |
| 3 | `STACKTRACE` (`rank.ts`), `SIGNATURE` (`parsers/stacktrace.ts`) | fixed, `a1bf5983` |
| 4 | `email` observer, `redaction-patterns.ts:171` | **deferred** — see below |
| 5 | 3 lookbehind patterns, `redaction-patterns.ts` | **open, unfiled** — see below |
| 6 | `/\s+$/` trailing-whitespace strip, `normalize.ts:10` | fixed, `trimEnd()` — see below |

## Deferred: instance 4 (`email`)

LOCKED §9d baseline entry (138 / 1,299 / 4,551 ms at 12.5 / 25 / 50 KB). Changing
it needs its own spec → security-reviewer chain. **It is a count-only observer —
it never modifies text** (`OBSERVED_PATTERNS`, redaction-patterns.ts:167), so a
size gate on the observer loop may be a cheaper correct fix than touching the
locked pattern. Recorded as an option; not acted on.

## Open: instance 5 (three lookbehinds)

Found while measuring instance 3. On a 50 KB whitespace run, `redactWithFindings`
costs 16-24 s, and it is **not** the email pattern:

| pattern | ms |
|---------|-----|
| `aws_secret_key` `/(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/g` | 6,132 |
| `basic_auth_header` `/(?<=authorization\s*[:=]\s*basic\s+)…/gi` | 4,598 |
| `api_key_header` `/(?<=(?:x-api-key\|…)\s*[:=]\s*)…/g` | 4,156 |

Variable-length lookbehind containing `\s*`, re-evaluated at every position.
Same class, third variant. Not filed as a spec yet.

## Fixed: instance 6 (`normalize`'s trailing-whitespace strip)

Third variant of the shape: the required literal is a **zero-width anchor**, not
a character. `/\s+$/` on a whitespace run that is not at end-of-line backtracks
the whole run at every offset. It is the earliest instance in the pipeline —
`normalize` is the first structural pass over every raw tool output and file
read, ahead of any size cap (redaction runs first, then normalize).

Fixed by `String.prototype.trimEnd()`, which is exactly equivalent (ES `\s` is
WhiteSpace + LineTerminator, the identical set `trimEnd` removes; `$` without
`m` anchors only at end of string) and linear. Measured through the public
`classifyOutput`: 200 KB space run 13,846 ms → <1 ms; 200 KB tab run 17,046 ms →
<1 ms (source: `packages/output-filter/src/normalize.ts`).

The guard needed **2x** the suite's shared 100 KB. Each backtrack step here is a
bare anchor check, cheaper per step than the class/literal patterns, so at 100 KB
the unbounded form cost only 3.2-4.0 s and sat under the shared 5 s ceiling. Same
lesson as below, one level sharper: the ceiling separates only if the size is
tuned to the *per-step* cost of the specific pattern, not to the class.

## Lesson for the guard test

A timing ceiling only guards what it separates. The first fix's suite ran at
50 KB with a 5 s ceiling — where four of five reverted patterns cost 2.9-4.7 s
and stayed green. Because the defect is quadratic and the fix linear, **raising
the input size is the cheap separator**: at 100 KB the cheapest reversion costs
12.2 s. Drive each pattern through its own real call site, and verify each bound
goes red alone.

## Related

- [[entities/output-filter]] — instances 2, 3 and 6.
- [[entities/policy]] — instances 1, 4, 5.
