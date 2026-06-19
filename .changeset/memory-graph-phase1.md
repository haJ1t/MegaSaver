---
"@megasaver/memory-graph": minor
"@megasaver/gui": minor
"@megasaver/cli": minor
---

Memory Graph — Phase 1: a typed projection of the memory you already capture into
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
