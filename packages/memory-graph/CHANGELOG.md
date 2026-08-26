# @megasaver/memory-graph

## 1.1.4

### Patch Changes

- Updated dependencies [297f9ac]
  - @megasaver/shared@1.3.2

## 1.1.3

### Patch Changes

- 07a4e3d: Fix a quadratic ReDoS in `parseWikiPage`'s citation anchor strip
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

  | shape                     | 12.5 KB  | 50 KB    | 100 KB    |
  | ------------------------- | -------- | -------- | --------- |
  | whitespace run, before    | 148 ms   | 2,514 ms | 10,919 ms |
  | whitespace run, after     | 0.014 ms | 0.056 ms | 0.108 ms  |
  | same-line `#` run, before | 24 ms    | 559 ms   | 4,541 ms  |
  | same-line `#` run, after  | 0.010 ms | 0.037 ms | 0.090 ms  |

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

- 07a4e3d: Exclude `[` from the wikilink target class in `parseWikiPage`. Ninth instance of
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

  | input  | before    | after  |
  | ------ | --------- | ------ |
  | 25 KB  | 1,158 ms  | 0.2 ms |
  | 50 KB  | 5,847 ms  | 0.3 ms |
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

- Updated dependencies [ad32371]
  - @megasaver/shared@1.3.1

## 1.1.2

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0

## 1.1.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0

## 1.1.0

### Minor Changes

- 66817e2: Memory Graph — Phase 1: a typed projection of the memory you already capture into
  a navigable network, plus a visual graph view.

  - New leaf package `@megasaver/memory-graph`: pure `buildGraph(input)` projecting
    the existing entities into typed nodes (`project · session · memory · evidence
· chunkset`) and edges (`contains · scope · project-memory · cites · chunk-of ·
from-session · conflict · supersede · duplicate`). Depends only on `shared`+`zod`
    (no core import); the IO/loading lives in the bridge/CLI, so the projection is
    unit-tested entirely with fixtures.
  - `apps/gui` bridge endpoint `GET /api/claude-sessions/:dir/:id/memory/graph`
    loads overlay memory + evidence, computes conflict edges (`checkConflicts`),
    and returns the graph JSON; a new cockpit **Memory Graph** panel renders it with
    cytoscape.js (color by node kind, provenance arrows, conflict edges dashed,
    click a node for detail).
  - `mega memory graph <project> --json` prints the project-scoped graph
    (project/session/memory + conflict edges) for scripting and tests.

  Read-only projection — never mutates memory/evidence or user files; redacted
  evidence/chunk labels are rendered as-is. Code/symbol/wiki nodes, a memoization
  cache, and live SSE growth are Phase 2/3.

- 1e3bbe1: Memory Graph — Phase 2: unify the wiki + code layers into the graph, bridged by
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

- 4e8c6e8: Memory superset increment 1: semantic recall + entity graph +
  memoryRelevance wiring.

  - core: per-project memory-vector sidecar (`embedMemoryEntries`,
    `memoryEmbeddingsSidecarPath`, `memoryEmbedText`) keyed by memory id,
    incremental by content hash — opt-in, no model on import. New
    `searchMemoryEntriesSemantic` (cosine recall) alongside the BM25
    `searchMemoryEntries`. New `approvedMemoryFiles` / `staleMemoryFiles`
    helpers for the context-pruner memory signal.
  - mcp-bridge: `get_relevant_memories` boundary-embeds the task best-effort
    and semantic-ranks when a sidecar exists, gracefully falling back to BM25.
    The context tools now feed `memoryRelevance` from ALL approved memory's
    relatedFiles instead of a BM25-narrowed subset.
  - memory-graph: new `entity` node kind + `entity-mention` edge kind;
    deterministic (no-LLM) entity extraction from each memory's
    relatedSymbols / relatedFiles, enabling cross-memory entity aggregation.

### Patch Changes

- 32f852a: Fix memory `relatedFiles` and wiki `(source:)` citations splitting into two
  file nodes when the same path is referenced both ways. `parseWikiPage`
  canonicalizes `fileCites` (strips wrapping backticks/quotes, a `:line[-range]`
  suffix, and a leading `./`), but both graph loaders only stripped a leading
  `./` from `relatedFiles`. A `relatedFiles` entry like `src/x.ts:12` or
  `` `src/x.ts` `` therefore produced a distinct file-node id from the wiki
  fileCite `src/x.ts`, so the intended single bridged node — carrying both the
  `code-link` and the `wiki-cite` edge — never formed.

  The path canonicalization is extracted into a pure `canonicalizeFilePath`
  helper exported from `@megasaver/memory-graph` (shared + zod only; no fs/yaml).
  `parseWikiPage` calls it (fileCite behaviour unchanged), and both the CLI and
  bridge loaders apply it to `relatedFiles` at the loader boundary so the same
  canonical string feeds both the file-node set and `buildGraph`. `buildGraph`
  stays a pure projection.

- 32f852a: Harden the Memory Graph against real-world data after Phase 2 (bug-fix sweep).

  - `buildGraph` now namespaces `file`/`symbol`/`wiki` node ids by kind
    (`file:` / `symbol:` / `wiki:`). These ids derive from free-form strings
    (paths, symbol names, wiki page paths) that can collide across kinds — a wiki
    page cited by its `.md` path, or one bare module name used as both a file path
    and a symbol — which previously produced two nodes sharing one id (the second
    silently dropped, one of its edges collapsed). The three id spaces are now
    disjoint, and `add` is idempotent on node id for within-kind repeats.
  - `parseWikiPage` strips a trailing ` #anchor` from `(source:)` citations so an
    anchored reference no longer yields a junk file-node id.
  - The bridge parents workspace-scoped overlay memories to a synthetic workspace
    project node, so project-scoped memories get their `project-memory` edge
    instead of rendering as orphans (matching the CLI graph shape).
  - GUI: the header node/edge counts reflect the _visible_ graph after a layer
    toggle (not the raw server totals); a selected node's detail panel clears when
    its layer is toggled off; `decision` memories get a distinct hue; empty meta
    arrays no longer render as blank detail rows.
  - Removed a dead lexical path-confinement guard (the symlink skip is the real,
    now-tested confinement) and added tests that exercise the symlink-escape path,
    `edgeCount == edges.length`, and `graphSchema` rejection.

- Updated dependencies [7fcd881]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
