---
"@megasaver/memory-graph": patch
"@megasaver/gui": patch
"@megasaver/cli": patch
---

Harden the Memory Graph against real-world data after Phase 2 (bug-fix sweep).

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
- GUI: the header node/edge counts reflect the *visible* graph after a layer
  toggle (not the raw server totals); a selected node's detail panel clears when
  its layer is toggled off; `decision` memories get a distinct hue; empty meta
  arrays no longer render as blank detail rows.
- Removed a dead lexical path-confinement guard (the symlink skip is the real,
  now-tested confinement) and added tests that exercise the symlink-escape path,
  `edgeCount == edges.length`, and `graphSchema` rejection.
