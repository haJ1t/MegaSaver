---
"@megasaver/context-gate": patch
---

Fix a superquadratic ReDoS in `FILE_PATH` (`session-hints.ts`), the pattern
`extractFailureSignatures` uses to distil stored failure blobs into ranking
hints.

`/[\w./\\-]*\w+\.[a-zA-Z]{1,5}(?::\d+)?/g` placed two unbounded quantified runs
over overlapping classes back to back — `\w` is a subset of `[\w./\\-]`, so the
split between them was ambiguous at every offset *and* every start position
rescanned to end-of-input to fail the `\.`. Measured through
`extractFailureSignatures`: 1.2 s at 2 KB, 9.1 s at 4 KB, 80.5 s at 8 KB
(~7x per doubling).

4 KB was the shipped worst case, not a crafted one: both capture sites store
`redact(...).redacted.slice(0, 4000)` (`run-command.ts:305`, `:574`). The cost
was also persisted and amplified — up to `MAX_OVERLAY_FAILURES` (50) stored
records are re-extracted by `buildSessionHints` / `buildOverlayHints` on every
read and exec, including inside the Claude Code `guard-run` hook, so one session
that captured a hex dump or a long identifier run added minutes of CPU to every
subsequent tool call, permanently.

Fixed by collapsing the second run to the single `\w` it actually required:
`/[\w./\\-]{0,255}\w\.[a-zA-Z]{1,5}(?::\d+)?/g` — 2.3 ms at 4 KB. Semantics are
preserved exactly (the character before the dot must still be a word char,
everything before it still comes from the wider class); verified identical on 22
real diagnostic lines — tsc caret and parenthesised, rustc, go, vitest, and
node/java/python frames, Windows `\` paths, deep monorepo paths — plus 200k
randomised strings over the triggering alphabet.

The one deliberate divergence is the 256-char cap on the leading run, matching
the already-merged twin in `@megasaver/output-filter`: a path whose head exceeds
256 chars now yields a clipped signature. A clipped path is still a substring of
the output it should boost, and real paths are far shorter.

The obvious alternative collapse `[\w./\\-]{1,256}\.` is equally fast but was
rejected: it drops the `\w`-before-dot requirement and starts matching `-.ts`,
`..ts` and `a/.js`.

Guarded by `test/session-hints-redos.test.ts`, which drives the exported
function (never the bare regex) at the shipped 4000-char cap and asserts a
growth ratio rather than a wall-clock ceiling.
