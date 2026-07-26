---
title: "ReDoS case: instance 6, the missed twin (context-gate)"
tags: [concept, redos, case-study, context-gate, regex]
sources: [packages/context-gate/src/session-hints.ts, packages/context-gate/test/session-hints-redos.test.ts]
status: active
created: 2026-07-26
updated: 2026-07-26
---

# Instance 6: the missed twin (`context-gate`)

Case study for [[concepts/unbounded-run-redos]].

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

## Why it survived

Not a code problem — a **wiki index** problem. The registry page's `sources:`
frontmatter listed only `output-filter` and `policy`. `context-gate` was absent,
so a wiki-first sweep for this defect class never pointed at `session-hints.ts`.
Added to `sources:` as part of the fix.

**Rule:** when the registry records a new instance, every package that holds a
member of the class goes in `sources:` in the same edit — including packages that
merely *copied* a fixed pattern. A defect class is indexed by the pattern shape,
not by the package that first hit it.

## Shapes that fire it, and shapes that don't

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

## Why it was critical, not theoretical

4 KB is not a probe size, it is the **shipped cap**: `run-command.ts:305` and
`:574` both store `redact(outcome.capture.raw).redacted.slice(0, 4000)`, so the
cap IS the worst case. And the cost is persisted and amplified —
`MAX_OVERLAY_FAILURES=50` records are re-extracted by `buildOverlayHints`
(`overlay-failures.ts:101`) and `buildSessionHints` (`session-hints.ts:86`) on
every read and exec (`run.ts:134`, `run.ts:315`, `run-command.ts:251`,
`run-command.ts:522`, and the Claude Code hook at
`apps/cli/src/hooks/guard-run.ts:196`). One poisoned session added minutes of CPU
to every later tool call, permanently.

## Related

- [[concepts/unbounded-run-redos]] — the registry.
- [[concepts/redos-growth-ratio-measurement]] — this instance's guard is where the
  n-vs-2n ratio instrument was first worked out (and later superseded under load).
- [[entities/context-gate]]
