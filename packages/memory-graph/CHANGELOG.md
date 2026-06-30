# @megasaver/memory-graph

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
