---
"@megasaver/memory-graph": minor
"@megasaver/gui": minor
"@megasaver/cli": minor
---

Memory Graph — Phase 2: unify the wiki + code layers into the graph, bridged by
shared file nodes.

- `@megasaver/memory-graph` (leaf) gains `file · symbol · wiki` node kinds and
  `code-link · wiki-link · wiki-source · wiki-cite` edge kinds, plus a pure
  `parseWikiPage(relPath, content)` (frontmatter title/tags/status/sources,
  `[[link]]` targets with alias/anchor stripped, and path-shaped `(source: path)`
  body citations). `buildGraph` projects `files`/`symbols`/`wikiPages` into the
  new nodes/edges, resolving `[[link]]`/`sources` to wiki pages by
  path/basename/title (collision-safe: an ambiguous basename/title resolves to
  nothing rather than the wrong page). The leaf stays shared+zod only — no fs,
  no yaml.
- The bridge endpoint and `mega memory graph` now walk the project's
  `<cwd>/wiki/{entities,concepts,decisions,syntheses,workflows,sources}` (strictly
  path-confined to `<cwd>/wiki/`, symlinks skipped) and derive `file` nodes from
  `memory.relatedFiles` ∪ wiki `(source: …)` citations — so a file referenced by
  both a memory and a wiki page is ONE node, bridging runtime memory ↔ code ↔
  wiki knowledge.
- The cockpit Memory Graph panel renders the new kinds (file slate, symbol
  grey-blue, wiki violet) with Wiki/Code layer toggles that hide a layer's nodes
  and their incident edges.

Read-only — never mutates the wiki or user files; the wiki walk never reads
outside `<cwd>/wiki/`. A materialization cache and live SSE growth remain Phase 3.
