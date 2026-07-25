---
title: Unbounded-run ReDoS (recurring defect class)
tags: [concept, redos, performance, regex, output-filter, policy, context-gate]
sources:
  - packages/output-filter/src/rank.ts
  - packages/output-filter/src/normalize.ts
  - packages/output-filter/src/classify.ts
  - packages/output-filter/src/parsers/stacktrace.ts
  - packages/output-filter/src/parsers/go-test.ts
  - packages/output-filter/src/parsers/eslint.ts
  - packages/output-filter/src/parsers/test-output.ts
  - packages/policy/src/redaction-patterns.ts
  - packages/context-gate/src/session-hints.ts
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
| 6 | `FILE_PATH`, `context-gate/src/session-hints.ts:17` | fixed — see below |
| 7 | `VITEST_OUT`, `PROSE_ANTI_VI` (`classify.ts`) | fixed — see below |
| 8 | `/\s+$/` trailing-whitespace strip, `normalize.ts:10` | fixed, `trimEnd()` — see below |
| 9 | `TEST_FAILURE` (`rank.ts`), `FAIL_LINE` (`go-test.ts`), `SUMMARY` + `PROBLEM_ROW` (`eslint.ts`), `SIGNATURE` (`test-output.ts`) | fixed — see below |

## Instance 6: the missed twin (`context-gate`)

`FILE_PATH` in `session-hints.ts` was the **twin** of instance 2's `FILE_PATH` in
`output-filter/src/rank.ts`. The rank.ts copy was bounded and merged; this copy
was never touched, and it was the **worse** form:

```
/[\w./\\-]*\w+\.[a-zA-Z]{1,5}(?::\d+)?/g     // two unbounded overlapping runs
```

`\w` is a subset of `[\w./\\-]`, so this is the *overlapping-runs* variant on top
of the class/literal one: the split between the runs is ambiguous at every offset
AND every start position rescans to fail the `\.`. Superquadratic, ~7x per
doubling through `extractFailureSignatures`: 1.2 s at 2 KB, 9.1 s at 4 KB,
80.5 s at 8 KB.

Fixed by collapsing the second run to a single required `\w`, which preserves the
semantics exactly (the char before the dot must still be a word char) while
removing the ambiguity — `/[\w./\\-]{0,255}\w\.[a-zA-Z]{1,5}(?::\d+)?/g`, 2.3 ms
at 4 KB. Verified behaviour-identical on 22 real diagnostic lines (tsc caret and
parenthesised, rustc, go, vitest, node/java/python frames, Windows `\` paths,
deep monorepo paths) and 200k randomised strings over the triggering alphabet.

The obvious-looking one-run collapse `[\w./\\-]{1,256}\.` is equally fast but
**not** equivalent — it drops the `\w`-before-dot requirement, so it starts
matching `-.ts`, `..ts` and `a/.js`. Rejected for that reason.

### Why it survived

Not a code problem — a **wiki index** problem. This page's `sources:`
frontmatter listed only `output-filter` and `policy`. `context-gate` was absent,
so a wiki-first sweep for this defect class never pointed at `session-hints.ts`.
Added to `sources:` as part of the fix.

**Rule:** when this page records a new instance, every package that holds a
member of the class goes in `sources:` in the same edit — including packages that
merely *copied* a fixed pattern. A defect class is indexed by the pattern shape,
not by the package that first hit it.

### Shapes that fire it, and shapes that don't

The trigger is a long run of characters that `\w` and the wider class BOTH
accept. Accidental shapes are enough — no crafted input needed:

| shape | 4 KB cost, unfixed |
|-------|-----|
| `'x'.repeat(4000)` | 9.1 s |
| hex dump, `'a1b2c3d4'.repeat(500)` | 11.4 s |
| identifier run, `'a_1__b2_'.repeat(500)` | 10.1 s |
| path-ish, `'a/b-c'.repeat(800)` | 19.5 ms — does NOT fire |
| 120 lines of real tsc stderr | 0.4 ms |

`a/b-c` is safe because `/` and `-` are outside `\w`, so the second run cannot
extend. Real base64 and npm `sha512-` integrity hashes are safe for the same
reason — `+` and `=` break the run. **Do not cite base64 as an example for this
instance**; hex dumps and identifier runs are the real ones.

### Why it was critical, not theoretical

4 KB is not a probe size, it is the **shipped cap**: `run-command.ts:305` and
`:574` both store `redact(outcome.capture.raw).redacted.slice(0, 4000)`, so the
cap IS the worst case. And the cost is persisted and amplified —
`MAX_OVERLAY_FAILURES=50` records are re-extracted by `buildOverlayHints`
(`overlay-failures.ts:101`) and `buildSessionHints` (`session-hints.ts:86`) on
every read and exec (`run.ts:134`, `run.ts:315`, `run-command.ts:251`,
`run-command.ts:522`, and the Claude Code hook at
`apps/cli/src/hooks/guard-run.ts:196`). One poisoned session added minutes of CPU
to every later tool call, permanently.

## Third variant: `^\s*` under the `m` flag

Instance 7 is a variant worth naming separately. `\s` matches `\n`, so an
`^\s*`-led alternative under `m` re-scans the whole remaining whitespace region
from every line start of a blank-line block: 31.8 s through `classifyOutput` on
100 KB of newlines. The bound (`\s{0,64}`) costs no reach — `^` re-anchors at
every line, so an indent match that spanned a newline was already reachable from
the later line start.

Its exposure differs from 1-6: `classifyOutput` is a **public export that only
normalizes, never collapses**. `filterOutput` feeds it post-`collapseRepeatedLines`
text, which defuses the driver; `mega bench` (`apps/cli/src/commands/bench.ts`)
passes raw command output and had no such shield. Second lesson, alongside the
guard-size one: check what the *public* entry point does, not what the internal
caller happens to do first.

## Instance 9: the five siblings instance 7 left behind

Instance 7 bounded the `^\s*`-under-`m` shape in `classify.ts` and stopped
there. Five more members of that exact shape were sitting in the same package,
untouched:

| pattern | file |
|---------|------|
| `TEST_FAILURE` `/^(?:FAIL\|\s*[✗×])\s\|…/im` | `rank.ts` |
| `FAIL_LINE` `/^\s*--- FAIL:/m` | `parsers/go-test.ts` |
| `SUMMARY` `/^\s*✖ \d+ problems?/m` | `parsers/eslint.ts` |
| `PROBLEM_ROW` `/^\s+\d+:\d+\s+(?:error\|warning)\s/m` | `parsers/eslint.ts` |
| `SIGNATURE` `/^(?:PASS\|FAIL)\s\|^\s*[✓✗×]\s\|…/m` | `parsers/test-output.ts` |

All five bounded to `{0,64}`/`{1,64}`, same as instance 7.

### The driver is crafted, not accidental

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

### Measurements

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

### Why they survived

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

## Fixed: instance 8 (`normalize`'s trailing-whitespace strip)

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

### Prefer a growth ratio to a ceiling (instance 6)

A ceiling is load- and runtime-dependent; a **growth ratio** is not. Instance 6's
guard (`packages/context-gate/test/session-hints-redos.test.ts`) samples the real
function at n and 2n and fails above 2.5x: bounded is linear (~2.0x), the defect
measured 5.4-5.7x. Two things make it hold up where the earlier attempt at a ratio
failed (there the unbounded form measured only 1.81x, so it never separated):

- **min-of-trials, not mean.** Scheduler noise can only inflate a duration, so a
  spike in the 2n sample inflates that trial's ratio and a spike in the n sample
  deflates it — the minimum discards the inflated trials and can only make the
  assertion harder to pass. A single un-minimised trial hit 2.91x under four busy
  cores; the min over 5 trials stayed at 1.09-1.94x idle and loaded.
- **Calibrated repeat count, not a fixed one.** Vitest cannot interrupt a
  synchronous loop — `timeout` only fires at async boundaries, so a fixed repeat
  count multiplies the pathological cost and hangs for 17+ minutes instead of
  going red. Deriving the count from one real call spends ~60 ms per sample when
  bounded and drops to a single repeat when not.

Also: size the guard at the **shipped cap**, not an arbitrary probe size, and drive
the exported function — never the bare regex. A sibling fix was previously weakened
by asserting on the pattern instead of its call site.

## Related

- [[entities/output-filter]] — instances 2, 3, 7, 8 and 9.
- [[entities/policy]] — instances 1, 4, 5.
- [[entities/context-gate]] — instance 6.
