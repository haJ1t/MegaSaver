---
title: Unbounded-run ReDoS (recurring defect class)
tags: [concept, redos, performance, regex, output-filter, policy, context-gate, memory-graph]
sources:
  - packages/output-filter/src/rank.ts
  - packages/output-filter/src/normalize.ts
  - packages/output-filter/src/classify.ts
  - packages/output-filter/src/parsers/stacktrace.ts
  - packages/output-filter/src/parsers/pytest.ts
  - packages/output-filter/src/parsers/go-test.ts
  - packages/output-filter/src/parsers/eslint.ts
  - packages/output-filter/src/parsers/test-output.ts
  - packages/policy/src/redaction-patterns.ts
  - packages/context-gate/src/session-hints.ts
  - packages/memory-graph/src/parse-wiki.ts
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
| 4 | `email` observer, `redaction-patterns.ts` | fixed — see below |
| 5 | 3 lookbehind patterns, `redaction-patterns.ts` | fixed — see below |
| 6 | `FILE_PATH`, `context-gate/src/session-hints.ts:17` | fixed — see below |
| 7 | `VITEST_OUT`, `PROSE_ANTI_VI` (`classify.ts`) | fixed — see below |
| 8 | `/\s+$/` trailing-whitespace strip, `normalize.ts:10` | fixed, `trimEnd()` — see below |
| 9 | `FAILURE_HEADER`, `parsers/pytest.ts:4` | fixed — see below |
| 9 | `TEST_FAILURE` (`rank.ts`), `FAIL_LINE` (`go-test.ts`), `SUMMARY` + `PROBLEM_ROW` (`eslint.ts`), `SIGNATURE` (`test-output.ts`) | fixed — see below |
| 9 | citation anchor strip, `memory-graph/src/parse-wiki.ts:79` | fixed — see below |
| 9 | wikilink scanner, `memory-graph/src/parse-wiki.ts:64` | fixed — see below |

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
## Instances 4 and 5 (`packages/policy`) — fixed 2026-07-25

Both closed by one spec,
[[docs/superpowers/specs/2026-07-25-policy-redaction-redos-design]], with one
bound each. Guard: `packages/policy/test/redact-redos.test.ts`.

### Instance 5: the lookbehind variant

**V8 evaluates a lookbehind right to left.** That is the whole mechanism, and it
is why these three read as safe: the `\s*` that rescans is the one written
*last*, nearest the value, not the one nearest the key literal. At every start
position it consumes the whole preceding whitespace run, requires the delimiter,
fails, and gives back one character at a time.

| pattern | bound added | 50 KB | 100 KB |
|---------|-------------|-------|--------|
| `aws_secret_key` | trailing `\s*` → `\s{0,64}` | 2,206 ms | 9,412 ms |
| `basic_auth_header` | `basic\s+` → `basic\s{1,64}` | 1,894 ms | 8,350 ms |
| `api_key_header` | trailing `\s*` → `\s{0,64}` | 1,280 ms | 7,606 ms |

The **leading** `\s*` in each was deliberately left alone. Reaching it needs the
delimiter within 64 characters behind, and one delimiter per ≤64 characters is
exactly what caps the leading run — the two conditions are mutually exclusive, so
it is O(n) already. Bounding it too measures identical (10–140 ms at 200 KB
across `ws=ws`, `ws:ws`, `(ws×500)basic(ws×500)` and `(ws×64)=`). **A bound that
is not load-bearing is a change no red test can justify.**

### Instance 4: `email`, and why the size gate was the wrong fix

This page previously recorded "a size gate on the observer loop may be a cheaper
correct fix than touching the locked pattern." Reading the sink says otherwise —
**`OBSERVED_PATTERNS` is not count-only everywhere.** `redactForLedger`
(`redact.ts:53-59`) runs the same array and actually *replaces*, because an email
must never persist into a ledger `sourcePath` label (F-FW-1). A gate in
`redactWithFindings` leaves that second loop quadratic; a gate in both turns a
DoS into an email leak above the cap. The gate also zeroes the `observed` count
on exactly the large diffs the observer exists for.

Bounding the local part to `{1,64}` (RFC 5321 §4.5.3.1.1) fixes both loops at the
root: 6,049 → 23,098 ms at 50 → 100 KB of letters, now linear. The bound is still
greedy **with backtracking**, so an over-long local part does not stop matching —
the match starts later, at the same `@` — and the reported count is unchanged.
The domain run needs no bound: its start positions are the `@`s and each run it
opens is terminated by the next `@`, so the total is already O(n).

**Rule this adds:** before gating a loop to dodge a locked literal, grep for the
other callers of the array. "Count-only" was a property of one call site, not of
the data.

### On the LOCKED table

`aws_secret_key` is row 5 of the §5a baseline
(`docs/superpowers/specs/2026-05-10-bb3-policy-design.md`). `api_key_header`,
`basic_auth_header` and `email` are **not** in it. The lock is documentary — no
snapshot test pins pattern bytes — and its amendment procedure was set by the two
`jwt` amendments of 2026-07-20, both for this same defect class: add a dated
footnote, never rewrite the row. Followed here.

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

## Fixed: instance 9 (pytest's failure-header banner)

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
## Fixed: instance 9 (wiki citation anchor strip, `memory-graph`)

First instance **outside the tool-output pipeline** — it runs on wiki markdown,
not on captured command output, which is why every earlier sweep of this class
missed it. `/\s+#\S.*$/` carried two variants at once: `\s+#` (class/literal on
whitespace) and `.*$` (zero-width literal, instance 8's variant). Its input is
the `[^)]+` capture of `/\(source:\s*([^)]+)\)/g`, which accepts whitespace and
newlines unbounded, and no read path caps page size — `mega memory graph`
(`apps/cli/src/commands/memory/read-wiki.ts:38`) and the GUI bridge route
(`apps/gui/bridge/routes/memory-graph.ts:90`) both hand whole files to
`parseWikiPage`. Through that export: whitespace run 148 / 2,514 / 10,919 ms at
12.5 / 50 / 100 KB; end to end `mega memory graph` on one 100 KB poisoned page
12,619 ms → 592 ms (source: `packages/memory-graph/src/parse-wiki.ts`).

Fixed by **dropping** both runs rather than bounding them: `/\s#\S[\s\S]*/`. The
single `\s` is exactly equivalent because the surrounding `.trim()` already
absorbs the rest of the run, and `[\s\S]*` cannot fail, so the tail consumes to
end of string with nothing to backtrack. When a trailing `.trim()` or an
end-anchored tail already makes the run irrelevant, deleting the quantifier beats
capping it — same move as instance 8's `trimEnd()`, and it leaves no magic
number to justify.

One deliberate divergence: `.` cannot cross a line terminator, so the old form
refused to strip an anchor followed by a newline and kept the whole multi-line
blob as the file node id. Characterised, not assumed — over 1,000,000 randomised
strings on the triggering alphabet, 64,775 diverged and **0** diverged for any
reason other than a line terminator inside the stripped tail; on the repo's own
wiki (75 pages, 54 captures, 4 anchor-stripped) the two forms agree on every one.
## Fixed: instance 9 (wikilink scanner, `memory-graph`)

Fourth variant: the permissive class accepts the **opening delimiter of its own
literal**. `/\[\[([^\]]+)\]\]/g` excludes only `]`, so on a `]`-free run of `[`
every `[[` pair rescans to end-of-input — 1,158 / 5,847 / 32,755 ms at 25 / 50 /
100 KB, through the exported `parseWikiPage` (source:
`packages/memory-graph/src/parse-wiki.ts:64`). Fixed by excluding `[` as well,
`[^\][]+`: each scan then stops at the next `[`, so the total is the input
length — 0.2-0.3 ms at the same sizes. Behaviour-identical on all 75 scanned
pages / 471 wikilinks of the real wiki.

**This one is low, and the reason matters for triage.** The two call sites —
`mega memory graph` (`apps/cli/src/commands/memory/read-wiki.ts:38`) and the
token-gated localhost GUI bridge (`apps/gui/bridge/routes/memory-graph.ts:90`) —
walk only the six `WIKI_FOLDERS` and skip `wiki/raw/`, so the
sink is fed operator-authored repo files, never external content. And nothing
naturally occurring fires it: any `]` truncates the backtrack tail, so markdown,
code fences, JSON and base64 are all sub-millisecond, and the longest `[` run
anywhere in `wiki/` is 2. Real defect, self-inflicted-only trigger. The size cap
that would have prevented it does not exist here — both walkers `readFile` whole
pages, and the largest one they scan today is 57,576 bytes.

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

### One shape does not separate every bound (instances 4-5)

Reverting each of the four bounds alone showed the ratio guard is **per-shape**,
not per-function: `aws_secret_key` reverted goes red only on a space run (3.77x)
while the tab run stays green — and `api_key_header` reverted is the exact
mirror, red on tabs (3.89x), green on spaces. On the shape it does not separate,
the reverted pattern still burns 65–100 s at these sizes and the assertion passes
anyway. Carry one shape per member of the whitespace class, and revert each bound
individually to find out which shape is the one that catches it.

Also: size the guard at the **shipped cap**, not an arbitrary probe size, and drive
the exported function — never the bare regex. A sibling fix was previously weakened
by asserting on the pattern instead of its call site.

## Not this class

`compileGlob` (`packages/policy`) blew up exponentially in 2026-07, but it is a
**different shape** and a bound-the-run patch does not touch it: the regex there
is *built from* untrusted input rather than applied to it. See
[[concepts/glob-compile-redos]].
### Minimise per SIDE, not the per-trial ratio

Carried over from the same lesson applied to the quadratic `dedupe()` scan
(`packages/output-filter/test/dedupe-quadratic.test.ts`, 2026-07-25): that guard
shipped a 5 s ceiling documenting the reverted cost as 13.5 s in the test and
17.4 s in its changeset, and reproduction on the machine that wrote both gave
6.8-7.7 s — a 1.4x margin. Rewritten as an n-vs-2n ratio at 64k/128k lines with
a 2.75x threshold it reads 1.95-2.09x idle, 2.06-2.17x under four busy cores,
and 4.48x reverted.

Refinement over instance 6's form: take the **minimum of each side across trials
and then divide**, rather than the minimum of the per-trial ratios. Minimising
the ratio pairs an inflated n sample with a clean 2n sample, so it is biased
*downward* — toward false green. On the same reverted `dedupe()` it read 2.55
where the per-side form read 4.48. Instance 6's ~5.5x separation absorbs that
bias; a ~2x separation does not.

**When documenting a guard's margin, quote a reproduction, not an estimate.**
Both wrong numbers here were plausible and neither had been re-run. A margin
claim is only load-bearing if the revert was actually performed.
### Correction: minimise per SIZE, not the ratio (instance 9)

The min-of-trials rule above is right about *why* (noise only inflates) but wrong
about *what* to minimise. `min(large_i / small_i)` pairs a noise-inflated `small`
with a clean `large` and reports a **fraction** of the true growth. Instance 9's
guard reproduced this: on a loaded machine the min-of-ratios sampler read 2.94x
where min-per-size read 7.63x on the same defect, and the first cut of the test
passed against the unfixed code. Minimise each size independently and divide —
both minima converge on their true cost from above, so the quotient converges on
the true ratio.

Two more things instance 9 needed, where no shipped cap exists to size against:

- **A 4x size step, not 2x.** Linear then predicts 4.0 and the defect measured
  12.7-18.5x, so a threshold of 8 leaves ~2x margin on both sides. At 2x the
  bands are 2.0 vs 4.1 — too close to survive a busy runner.
- **An explicit per-test timeout.** The quadratic form needs ~70 s to produce its
  own red; with the file's 30 s default the revert check fails on a timeout
  instead of on the assertion, which proves nothing about the ratio.

## Related

- [[entities/output-filter]] — instances 2, 3, 7, 8 and 9.
- [[entities/policy]] — instances 1, 4, 5.
- [[entities/context-gate]] — instance 6.
- [[concepts/glob-compile-redos]] — the sibling defect class.
- `@megasaver/memory-graph` — instance 9 (no entity page yet).
