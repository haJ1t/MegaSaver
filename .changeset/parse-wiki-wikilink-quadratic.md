---
"@megasaver/memory-graph": patch
---

Exclude `[` from the wikilink target class in `parseWikiPage`. Ninth instance of
the unbounded-run class documented in `wiki/concepts/unbounded-run-redos.md`.

`/\[\[([^\]]+)\]\]/g` runs an unbounded greedy `[^\]]+` — which itself accepts
`[` — before the required `]]`. On a `]`-free run of `[`, every one of the ~N/2
`[[` pairs consumes to end-of-input and backtracks the whole run: O(N^2). Both
walkers feed it whole pages with no size cap (`mega memory graph` at
`apps/cli/src/commands/memory/read-wiki.ts:38`, the GUI bridge at
`apps/gui/bridge/routes/memory-graph.ts:90`), and 32 KB is a real page size —
the largest page they scan today is 57,576 bytes.

Measured through the exported `parseWikiPage`, one cold process per size, on
`'# t\n\n' + '['.repeat(n)`:

| input | before | after |
|-------|--------|-------|
| 25 KB | 1,158 ms | 0.2 ms |
| 50 KB | 5,847 ms | 0.3 ms |
| 100 KB | 32,755 ms | 0.2 ms |

`[^\][]+` is the whole fix: with `[` outside the class, each `[[` scan is bounded
by the distance to the next `[`, so the total is the input length. Verified
behaviour-identical on the real wiki — 75 scanned pages, 493,455 bytes, 471
wikilinks, zero differing pages (the longest `[` run anywhere in `wiki/` is 2).

Severity is low, not medium: nothing external reaches this sink. The walkers read
operator-authored repo pages under the six `WIKI_FOLDERS` and skip `wiki/raw/`,
the only external-ingest folder. No naturally occurring shape triggers it either
— any `]` truncates the backtrack tail, and real markdown, code fences and tables
all balance their brackets. Only a literal run of `[` fires it, and the longest
run present anywhere in `wiki/` is 2.

Two behaviour changes, both deliberate and pinned by tests: `[[a[b]]` no longer
yields the link `a[b` (an Obsidian target cannot contain `[`), and `[[[a]]` now
resolves to `a` instead of `[a`, which is the more correct reading — the
innermost `[[` is the link.
