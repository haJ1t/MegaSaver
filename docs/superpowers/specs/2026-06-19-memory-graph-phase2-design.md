---
title: Memory Graph — Phase 2 (Wiki + Code, unified via shared file nodes)
status: draft
risk: MEDIUM
created: 2026-06-19
topic: memory-graph-phase2
---

# Memory Graph — Phase 2 Design

## 1. Goal

Extend the Phase 1 memory graph so it also shows the project's **wiki knowledge**
and the **code** the memory touches, unified into one network. A file referenced
by both a memory (`relatedFiles`) and a wiki page (a `(source: path)` body
citation) becomes the **same** node — so the graph bridges *runtime memory ↔ code
↔ wiki knowledge* wherever a real shared file exists.

Phase 1 shipped: `project · session · memory · evidence · chunkset` nodes and
`contains · scope · project-memory · cites · chunk-of · from-session · conflict ·
supersede · duplicate` edges. Spec: `docs/superpowers/specs/2026-06-18-memory-graph-design.md`.

## 2. Scope

In scope:

- **Wiki ingestion** — parse `wiki/{entities,concepts,decisions,syntheses,workflows,sources}/**.md`
  into `wiki` nodes; `[[link]]` body links → `wiki-link` edges; frontmatter
  `sources:` that resolve to an ingested page → `wiki-source` edges.
- **Code layer** — `memory.relatedFiles` / `relatedSymbols` → `file` / `symbol`
  nodes + `code-link` edges.
- **The bridge** — wiki body `(source: path)` citations → `wiki-cite` edges to
  `file` nodes. File node id = the path string, so memory and wiki connect through
  the same file node where they reference it.
- GUI: render the new node/edge kinds (colors + edge styles) and a layer filter
  (toggle wiki / code).

Out of scope (non-goals):

- `wiki/raw/` (immutable, partly private) and `wiki/archive/` (stale) are NOT
  ingested.
- No fuzzy similarity edges (keyword/embedding) between wiki and memory — only the
  exact shared-file bridge and explicit links.
- No editing of the wiki from the graph (read-only, as Phase 1).
- Live SSE growth + a materialization cache remain Phase 3.

## 3. Architecture (extends Phase 1)

```
<cwd>/wiki/**.md ──► wiki reader (loader IO) ──► parseWikiPage (pure) ─┐
overlay/core memory + evidence ───────────────────────────────────────┼─► buildGraph (pure) ─► API ─► GUI
                                                                       │
                @megasaver/memory-graph (leaf): model + parseWikiPage + buildGraph (shared+zod only)
```

| Unit | Change |
|------|--------|
| `@megasaver/memory-graph` (leaf) | Add `file/symbol/wiki` to `nodeKindSchema`; `code-link/wiki-link/wiki-source/wiki-cite` to `edgeKindSchema`. Add `FileInput/SymbolInput/WikiInput` + extend `GraphInput` with `files/symbols/wikiPages`. Extend `buildGraph` to emit the new nodes/edges (file nodes shared by path id). Add pure **`parseWikiPage(relPath, content): WikiInput`** (frontmatter + `[[link]]` + `(source: path)` extraction — a minimal line/regex parser, NO yaml dependency, so the leaf stays shared+zod only). |
| Loader (bridge `apps/gui/bridge/routes/memory-graph.ts` + CLI `apps/cli/src/commands/memory/graph.ts`) | Resolve the workspace cwd → walk `<cwd>/wiki/{entities,concepts,decisions,syntheses,workflows,sources}/**.md` (path-confined; never escape `<cwd>/wiki/`), read each, call `parseWikiPage`. Derive `file` nodes from `memory.relatedFiles` ∪ wiki `fileCites`, `symbol` nodes from `relatedSymbols`. Feed `files/symbols/wikiPages` to `buildGraph`. Absent `wiki/` → empty wiki layer (no crash). |
| GUI `apps/gui/src/views/cockpit/memory-graph-panel.tsx` | Style new kinds (file = slate `#475569`, symbol = a distinct grey-blue, wiki = violet `#9333EA`); edge styles (`code-link`/`wiki-cite` thin solid to file, `wiki-link`/`wiki-source` violet). Extend the kind filter with wiki + code toggles. |

`@megasaver/memory-graph` stays a **leaf** (shared+zod only): the wiki *parsing*
is pure (string → `WikiInput`); the file *reading* (IO) lives in the loader.

## 4. Model additions (locked)

`WikiInput` (produced by `parseWikiPage`):
```
{ path: string;          // wiki-relative path, e.g. "entities/core.md" — the node id
  title: string;         // frontmatter title, else basename
  tags: string[];        // frontmatter tags (meta only in Phase 2)
  status: string;        // frontmatter status (active|stale|superseded), default "active"
  links: string[];       // [[link]] targets (raw text inside the brackets)
  sources: string[];     // frontmatter `sources:` entries
  fileCites: string[] }  // body `(source: <path>[:line])` citation paths (deduped)
```

`FileInput = { path: string }` (node id = path); `SymbolInput = { symbol: string }`.

| NodeKind | id | label | from |
|----------|----|-------|------|
| `wiki` | wiki-relative path | frontmatter title | `parseWikiPage` |
| `file` | path string | basename | memory.relatedFiles ∪ wiki.fileCites |
| `symbol` | symbol string | symbol | memory.relatedSymbols |

| EdgeKind | from → to | source |
|----------|-----------|--------|
| `code-link` | memory → file/symbol | `relatedFiles` / `relatedSymbols` |
| `wiki-link` | wiki → wiki | resolved `[[link]]` |
| `wiki-source` | wiki → wiki | resolved frontmatter `sources:` |
| `wiki-cite` | wiki → file | body `(source: path)` citation |

## 5. Link resolution (locked)

- **`[[X]]`** → resolve to the wiki page whose basename-without-`.md` (kebab) OR
  frontmatter `title` matches `X` (case/space-normalized). Strip any `[[X|alias]]`
  to `X` and any `#anchor`. No match → **drop the edge** (dangling links are not
  rendered in Phase 2). Edge is to the matched page's `path`.
- **frontmatter `sources:`** → if the entry resolves to an ingested wiki page
  (e.g. `sources/foo.md`), emit `wiki-source`; entries under `raw/` (not ingested)
  → skip.
- **`(source: path)` body citations** → the `path` (before any `:line`) becomes a
  `file` node id and a `wiki-cite` edge. If `path` is itself a wiki/raw path (not
  code), it still becomes a file node — that is acceptable (it is a real cited
  artifact); the *bridge to memory* only forms when memory also lists that path.
- `buildGraph`'s existing node-existence guard drops any edge whose endpoint node
  was not emitted; the `seen` set + undirected canonicalization (Phase 1) still apply.

## 6. Loader & path safety

- The loader resolves the session's cwd (Phase 1 already does, for the overlay
  store). It reads `<cwd>/wiki/<folder>/**.md` for the six in-scope folders only.
  All paths are resolved and confirmed to stay within `<cwd>/wiki/` (reject `..`
  / symlink escapes) before reading — the graph must never read outside the wiki.
- Wiki files are the user's own docs; labels are rendered as-is. No secret
  redaction concern beyond what already applies (the graph never reads the store's
  redacted chunks here).
- Missing `wiki/` or an unreadable file → that page is skipped; the rest of the
  graph still renders.

## 7. GUI

- cytoscape style classes for `file`/`symbol`/`wiki` (colors above), and the four
  new edge kinds. A file node shared by a `code-link` and a `wiki-cite` visually
  sits between the memory and wiki clusters — the bridge is literally visible.
- Filter controls gain "Wiki" and "Code" layer toggles (hide/show those node +
  edge kinds) on top of the Phase 1 kind filter.
- Large wiki: the existing cose layout + node cap apply; the detail panel shows a
  wiki node's title/tags/status and a file node's path.

## 8. Testing (TDD)

- **`parseWikiPage` (pure):** frontmatter title/tags/status/sources extraction;
  malformed/absent frontmatter (defaults); `[[link]]`, `[[link|alias]]`,
  `[[link#anchor]]` extraction; `(source: path)` and `(source: path:line)`
  citation extraction + dedupe; a page with none of these.
- **`buildGraph` extensions (pure, fixtures):** memory→file `code-link`; wiki→wiki
  `wiki-link`/`wiki-source`; wiki→file `wiki-cite`; **the bridge** — a memory and a
  wiki page that reference the SAME path produce ONE shared file node with both a
  `code-link` and a `wiki-cite` to it; dangling `[[link]]` (no page) → no edge;
  symbol nodes + edges.
- **Loader:** reads a fixture `wiki/` tree (path-confined; rejects a `..` escape);
  absent `wiki/` → empty wiki layer.
- **GUI:** the new kinds render (component smoke); filters toggle layers.

## 9. Risk & boundaries

- Risk **MEDIUM**: read-only still; the new capability is filesystem reads of the
  project's own `wiki/`, strictly path-confined to `<cwd>/wiki/` — the one real
  hazard (reading outside the wiki) is closed by the path check (§6).
- Leaf purity preserved: parsing is pure (no yaml dep, no IO); reading is in the
  loader. Core remains agent-agnostic.

## 10. Open questions (non-blocking)

- Whether to render `tags` as filterable groups (deferred to a later phase; tags
  are carried as node meta now).
- Project-scoped wiki vs session panel: the wiki belongs to the project; it is
  shown in the session-scoped panel because the session's cwd resolves the project
  root. A dedicated project-level graph view is a later consideration.
