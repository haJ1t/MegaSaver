---
title: Unbounded-run ReDoS (recurring defect class)
tags: [concept, redos, performance, regex, output-filter, policy, context-gate]
sources:
  - packages/output-filter/src/rank.ts
  - packages/output-filter/src/normalize.ts
  - packages/output-filter/src/parsers/stacktrace.ts
  - packages/policy/src/redaction-patterns.ts
  - packages/context-gate/src/session-hints.ts
status: active
created: 2026-07-20
updated: 2026-07-25
---

# Unbounded-run ReDoS

Three separate incidents in this repo share one defect shape. Treat it as a
class, not three bugs.

## The shape

> An unbounded greedy run over a permissive class, followed by a required
> literal, evaluated at every start position.

On input the class accepts but the literal never follows, every start position
scans to end-of-input and backtracks: O(starts x length). Two variants seen:

- **Class/literal** — `[A-Za-z]*Error`, `[\w./-]+\.\w{1,5}`, `eyJ[A-Za-z0-9_-]+\.`.
- **Overlapping runs** — `\s+at\s+.+`, where two adjacent quantifiers both
  accept whitespace, so the split between them is ambiguous at every offset.
  Same cost, but it fires on whitespace, which the delimiter-free probes miss.

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

## Related

- [[entities/output-filter]] — instances 2 and 3.
- [[entities/policy]] — instances 1, 4, 5.
- [[entities/context-gate]] — instance 6.
- [[concepts/glob-compile-redos]] — the sibling defect class.
