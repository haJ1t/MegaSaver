---
title: Memory Graph — Comprehensive Memory Model + Visual Network
status: draft
risk: MEDIUM-HIGH
created: 2026-06-18
topic: memory-graph
---

# Memory Graph — Design

## 1. Goal

Make the memory MegaSaver already captures **navigable as one network** and
**visible to the eye** in the GUI. Two layers, built together:

1. A comprehensive **memory graph model + builder** that projects the existing
   stores (memory, evidence, sessions, projects, chunks, conflicts) — plus code
   links and the wiki — into a single typed node/edge graph.
2. A **visual network view** in `apps/gui` to explore that graph (color by node
   kind, edge style by relation, click → detail, filter, search, live growth).

North-star: *"see how every decision/bug/rule connects, where it came from, what
it touches, and watch it grow live."*

## 2. Scope

In scope (all four dimensions the user selected as "hepsi"):

- **Knowledge & decision network** — memory↔memory edges (conflict / supersede /
  duplicate / related).
- **Provenance / lineage** — memory → evidence → chunk → session.
- **Code & wiki links** — memory ↔ file/symbol; wiki pages + `[[links]]`.
- **Live session growth** — the network updates as agents work (Phase 3).

Out of scope (non-goals):

- No new persisted *memory* model or new memory **types** — we project the
  existing `MemoryEntry` taxonomy, we do not invent a parallel one.
- The graph is **read-only**: rendering/exploration never mutates memory,
  evidence, or user files. (Editing memory stays in the existing CRUD panel.)
- No embeddings / semantic similarity edges in v1 (BM25/relations only).
- No multi-user / collaboration. Single developer, local.

## 3. Architecture

Five units, strictly one-directional dependencies; `@megasaver/core` stays
agent-agnostic and is **not** imported by the leaf model.

```
stores ──► Loader (IO) ──► buildGraph (pure) ──► Cache ──► Bridge API ──► GUI (cytoscape)
                                  ▲                                          
        @megasaver/memory-graph (leaf: model + projection, shared+zod only)
```

| Unit | Package / location | Responsibility | Depends on |
|------|--------------------|----------------|-----------|
| **Graph model + projection** | `@megasaver/memory-graph` (NEW leaf) | `GraphNode`/`GraphEdge` zod schema; pure `buildGraph(GraphInput) → Graph`. No IO. | `@megasaver/shared`, `zod` only |
| **Loader (IO)** | `apps/gui/bridge` + `mega memory graph` CLI | Load entities from all stores, compute conflicts, parse wiki, feed `buildGraph`. Cache + (Phase 3) file-watch → diff. | core, evidence-ledger, content-store, stats, registry, memory-graph |
| **Bridge API** | `apps/gui/bridge` | `GET /memory/graph`, `/memory/graph/neighbors/:id`, `/memory/graph/stream` (SSE, Phase 3). | Loader |
| **Visualization** | `apps/gui/src/views/memory-graph/` | cytoscape.js network; styling, layouts, detail panel, filters, search. | Bridge API (HTTP) |
| **Wiki/code ingestion** | Loader helpers (bridge/CLI) | Parse `wiki/**` frontmatter + `[[links]]`; map `relatedFiles`/`relatedSymbols` to file/symbol nodes. | none beyond fs + memory-graph |

Dependency-graph rule: `@megasaver/memory-graph` is a **leaf** (shared + zod
only). It must NOT import core. Therefore `buildGraph` takes **already-loaded
data** (`GraphInput`) — the IO/loading lives in the bridge/CLI, which may import
core/evidence-ledger/etc. This keeps the model pure and unit-testable, and
respects the §2 / §8 boundary rules and the existing dependency-graph allow-list.

## 4. Graph model (taxonomy — locked)

`GraphNode = { id, kind, label, meta }`:

| NodeKind | Source entity | id | label | key meta |
|----------|---------------|----|-------|----------|
| `project` | Project | `id` | name | rootPath |
| `session` | Session / OverlaySession | `id`/`liveSessionId` | short id | agentId |
| `memory` | MemoryEntry / OverlayMemoryEntry | `id` | title | `memoryType`, approval, confidence, source, scope, stale |
| `evidence` | EvidenceRecord | `evidenceId` | sourceKind + short id | status, retentionClass |
| `chunkset` | OverlayChunkSet | `chunkSetId` | source label (redacted) | rawBytes, redacted |
| `file` | from `relatedFiles[]` | path | basename | path |
| `symbol` | from `relatedSymbols[]` | symbol | symbol | — |
| `wiki` | `wiki/**.md` page | rel path | frontmatter title | tags, status, folder |

`GraphEdge = { id, kind, from, to, meta? }`:

| EdgeKind | from → to | Encoded by (existing field) | directed |
|----------|-----------|------------------------------|----------|
| `contains` | project → session | `Session.projectId` | yes |
| `scope` | session → memory | `MemoryEntry.sessionId` | yes |
| `project-memory` | project → memory | `MemoryEntry.projectId` (when scope=project) | yes |
| `cites` | memory → evidence | `MemoryEntry.evidence[]` / `EvidenceRecord.pinnedByMemoryIds[]` | yes |
| `chunk-of` | evidence → chunkset | `EvidenceRecord.returnedChunkRefs[].chunkSetId` + `redactedRawChunkSetId` | yes |
| `from-session` | evidence → session | `EvidenceRecord.sessionRef` | yes |
| `conflict` | memory ↔ memory | `checkConflicts()` = `contradiction` | no |
| `supersede` | memory → memory | `checkConflicts()` = `supersession` | yes |
| `duplicate` | memory ↔ memory | `checkConflicts()` = `duplicate` | no |
| `related` | memory ↔ memory | shared `relatedFiles`/`keywords` overlap (non-conflict) | no |
| `code-link` | memory → file/symbol | `relatedFiles[]` / `relatedSymbols[]` | yes |
| `wiki-link` | wiki → wiki | `[[link]]` in body | yes |
| `wiki-source` | wiki → file | frontmatter `sources:` / inline path | yes |

Conflict edges are **computed** (`packages/core/src/conflict-checker.ts`) — the
loader runs `checkConflicts()` over the memory set and materializes the result as
edges (they are not persisted today; the graph is where they become visible).

## 5. Build model — hybrid (derive + cache + live diff)

- **Derive (always correct):** `buildGraph` is a pure projection of the current
  store contents. No separate persisted graph store — the stores remain the
  single source of truth, so the graph can never drift.
- **Cache (perf):** the loader memoizes the derived graph per
  `(project|workspace, filterKey)` and invalidates on store mtime change. First
  request derives; subsequent requests serve cache until a store file changes.
- **Live diff (Phase 3):** a file-watcher on the store dirs recomputes and emits
  a **diff** (added/removed nodes+edges) over SSE; the GUI animates the delta.

Phase 1 ships derive + cache; the watcher/SSE is Phase 3. The API shape is fixed
up front so the GUI does not change when live arrives.

## 6. API surface

Bridge (HTTP, localhost):

- `GET /memory/graph?scope=<project|workspace>&id=<...>&kinds=<csv>&approval=<csv>&since=<iso>`
  → `{ nodes: GraphNode[], edges: GraphEdge[], stats: {...} }` (filtered).
- `GET /memory/graph/neighbors/:nodeId?depth=1` → subgraph around a node
  (click-to-expand; avoids shipping the whole graph for large stores).
- `GET /memory/graph/stream` (SSE, Phase 3) → `{ added, removed }` diffs.

CLI: `mega memory graph [--scope ...] [--json]` → prints the graph JSON (so the
projection is testable + scriptable without the GUI). Lives under
`apps/cli/src/commands/memory/`.

## 7. Visualization (`apps/gui`, cytoscape.js)

- **Library:** cytoscape.js — chosen over react-flow/d3-force for large typed
  networks: built-in layouts (`cose`/`fcose` force, `concentric`, `dagre`
  hierarchical), performant rendering, rich per-kind styling, mature
  interaction. (react-flow is for hand-authored flow diagrams; weaker for
  auto-laid networks.)
- **Styling:** node color by `kind` (legend matches the design mockup); memory
  nodes sub-styled by `memoryType`; edge style by `kind` (provenance solid +
  arrow, conflict dashed red, scope/link thin grey).
- **Interaction:** click node → detail panel (all fields + counts:
  evidence/conflicts/links); double-click → expand neighbors via the API; hover
  → highlight incident edges.
- **Controls:** filter by node kind / approval / confidence / scope / time
  window; full-text search (jump+focus); layout switcher; "fit"/zoom.
- **Empty/edge states:** empty store, single isolated node, very large graph
  (cap initial render to N nodes + "expand" affordance), redacted labels shown
  as-is (never un-redact).

## 8. Testing strategy (TDD)

- **`buildGraph` (pure) — the core of the test surface:** fixture entity sets →
  assert exact node/edge sets per kind. Covers every EdgeKind mapping, scope
  invariants, conflict materialization, dedupe of bidirectional edges, and that
  redacted labels pass through unchanged.
- **Wiki parser:** frontmatter + `[[link]]` extraction, missing/!malformed
  frontmatter, links to non-existent pages (dangling → no edge or marked).
- **Loader/cache:** cache hit/invalidate on mtime; both core (projectId) and
  overlay (workspaceKey) models.
- **Bridge API:** filter params, neighbors subgraph, error paths.
- **GUI:** component smoke (renders nodes/edges from a fixture graph; detail
  panel; filter). Full visual polish handled by §5 design skills in the GUI
  phase.

## 9. Phasing (each phase → its own implementation plan)

- **Phase 1 — Core graph + view (MVP, "ağı gör" works):**
  `@megasaver/memory-graph` model + `buildGraph` over memory/evidence/session/
  project/chunk/conflict; bridge `GET /memory/graph` + `/neighbors`; cytoscape
  view (color, edges, detail, filter, search); `mega memory graph` CLI; cache.
- **Phase 2 — Code & wiki links:** `relatedFiles`/`relatedSymbols` → file/symbol
  nodes + `code-link` edges; wiki parser → `wiki` nodes + `wiki-link`/
  `wiki-source` edges; filters extended.
- **Phase 3 — Live growth + timeline:** store file-watcher → diff → SSE; GUI
  animates additions; time-window scrubber ("memory over time").

## 10. Risk & boundaries

- Risk **MEDIUM-HIGH**: a new package + GUI surface, core-adjacent — but the
  graph is a **read-only projection**; it never mutates memory/evidence or user
  files, which removes the highest-risk failure modes. Per §12, GUI work pulls
  in the design skill routing (§5).
- Agent-agnostic core preserved: the model is a leaf; the wiki/code ingestion and
  IO live in the connector/app layer, never in `@megasaver/core`.
- Redaction honored: chunk/evidence labels are already redacted upstream
  (#147–#150); the graph renders them as-is and never reconstructs raw content.

## 11. Open questions (non-blocking)

- Overlay (live-first) vs core (project) model in the GUI: the GUI memory panel
  uses the overlay model today → Phase 1 graph defaults to **overlay/workspace
  scope**, with project scope as a filter. (Confirm during Phase 1 planning.)
- Large-graph cap N and the neighbors-expand UX — tune in Phase 1 with real data.
