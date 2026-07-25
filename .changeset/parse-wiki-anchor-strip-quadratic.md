---
"@megasaver/memory-graph": patch
---

Fix a quadratic ReDoS in `parseWikiPage`'s citation anchor strip
(`parse-wiki.ts`). Ninth instance of the unbounded-run class documented in
`wiki/concepts/unbounded-run-redos.md`, and the first one outside the tool-output
pipeline — this one runs on wiki markdown, not on captured command output.

`/\s+#\S.*$/` carried two members of the class in one expression:

- `\s+#` — an unbounded greedy whitespace run followed by a required literal.
  The pattern is unanchored and non-global, so every offset inside a whitespace
  run is a start position, each consumes to the end of the run and backtracks it
  whole to fail `#`.
- `.*$` — an unbounded run followed by a zero-width anchor (the `normalize`
  variant). Every `\s#\S` candidate scans to the next line terminator, fails `$`,
  and backtracks to zero.

The string it runs on is the `[^)]+` capture of `/\(source:\s*([^)]+)\)/g`, which
accepts whitespace and newlines without bound, and neither read path caps page
size: `mega memory graph <project>`
(`apps/cli/src/commands/memory/read-wiki.ts:38`) and the GUI bridge memory-graph
route (`apps/gui/bridge/routes/memory-graph.ts:90`) both `readFile` every
`wiki/{entities,concepts,decisions,syntheses,workflows,sources}/**/*.md` and hand
the whole file to `parseWikiPage`. One page with an unclosed `(source:` region
stalls the command.

Measured through the exported `parseWikiPage`, min over 5 trials:

| shape | 12.5 KB | 50 KB | 100 KB |
|-------|---------|-------|--------|
| whitespace run, before | 148 ms | 2,514 ms | 10,919 ms |
| whitespace run, after | 0.014 ms | 0.056 ms | 0.108 ms |
| same-line `#` run, before | 24 ms | 559 ms | 4,541 ms |
| same-line `#` run, after | 0.010 ms | 0.037 ms | 0.090 ms |

End to end, `mega memory graph` over a project whose wiki holds one 100 KB
poisoned page: 12,619 ms before, 592 ms after, byte-identical graph output.

Fixed by dropping both unbounded runs rather than bounding them:
`/\s#\S[\s\S]*/`. The single `\s` is exactly equivalent because the surrounding
`.trim()` already absorbs the rest of the whitespace run — the old pattern
matched at the run's first character and this one at its last, and both truncate
from the same `#`. `[\s\S]*` cannot fail, so the tail consumes to end of string
in one pass with nothing to backtrack.

The one deliberate divergence: `.*$` refused to strip an anchor when a line
terminator followed it, because `.` cannot cross one, and left the whole
multi-line blob as the file node id (`docs/x.md #sec\nmore prose`). The new form
strips it and the citation resolves to `docs/x.md`. That is strictly closer to
the stated intent — the file node must unify with the same path cited without an
anchor — and it is the entire behavioural difference: over 1,000,000 randomised
strings on the triggering alphabet (spaces, tabs, `\r`, `\n`, U+2028, `#`, path
characters), 117,204 carried an anchor, 64,775 diverged, and 0 diverged for any
reason other than a line terminator inside the stripped tail. On the repo's own
wiki — 75 pages, 54 `(source: …)` captures, 4 of them anchor-stripped — the two
forms agree on every one.

Guarded by `test/parse-wiki-redos.test.ts`, which drives the exported function
(never the bare regex) and asserts a growth ratio rather than a wall-clock
ceiling: a 4x step in page size from 12.5 KB to 50 KB, threshold 8x. Fixed
measures 3.96x and 3.81x against a linear expectation of 4.0; reverted it
measures 23.8x and 14.1x. The sampler takes the minimum per size and divides,
never the minimum of per-trial ratios — the latter pairs a noise-inflated small
sample with a clean large one and read 2.94x on this machine where the true
growth was 7.63x, i.e. it hides the defect it exists to catch.
