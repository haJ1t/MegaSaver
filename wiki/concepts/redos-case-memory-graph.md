---
title: "ReDoS cases: memory-graph wiki parser (instance 9)"
tags: [concept, redos, case-study, memory-graph, regex]
sources: [packages/memory-graph/src/parse-wiki.ts, apps/cli/src/commands/memory/read-wiki.ts, apps/gui/bridge/routes/memory-graph.ts]
status: active
created: 2026-07-26
updated: 2026-07-26
---

# ReDoS cases in `@megasaver/memory-graph`

Case studies for [[concepts/unbounded-run-redos]]. Both were fixed 2026-07-25.
No entity page for this package exists yet.

## Citation anchor strip (`parse-wiki.ts:79`)

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

## Wikilink scanner (`parse-wiki.ts:64`)

Self-delimiting-class variant: the permissive class accepts the **opening
delimiter of its own literal**. `/\[\[([^\]]+)\]\]/g` excludes only `]`, so on a
`]`-free run of `[` every `[[` pair rescans to end-of-input — 1,158 / 5,847 /
32,755 ms at 25 / 50 / 100 KB, through the exported `parseWikiPage` (source:
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

## Related

- [[concepts/unbounded-run-redos]] — the registry.
- [[concepts/redos-growth-ratio-measurement]] — the anchor-strip guard is the one
  that read 15.9x under a parallel `turbo` run and forced the move back to a
  size-separated ceiling.
