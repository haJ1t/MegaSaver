# Plan — Memory Superset Increment 1

Spec: `docs/superpowers/specs/2026-06-30-memory-superset-design.md`. TDD, HIGH-risk.
All steps additive; CI stays model-free.

## Layer 1A — Semantic memory recall (`@megasaver/core`)

1. RED: `embed-memory.test.ts` — incremental sidecar build with a counting fake
   `EmbedFn`: unchanged memory (same id+contentHash) carries vector forward, no
   re-embed; changed content re-embeds. → verify: test fails (no impl).
2. RED: `memory-search-semantic.test.ts` — injected sidecar + hand query vector:
   semantically-near memory outranks a BM25-equal far one; filters honored.
3. GREEN: `embed-memory.ts` (`memoryEmbeddingsSidecarPath`, `memoryEmbedText`,
   `embedMemoryEntries`) mirroring `embed-blocks.ts`; `searchMemoryEntriesSemantic`
   in `memory-search.ts`. Export from `core/index.ts`. → verify: core tests green.
4. GREEN: boundary embed in `get-relevant-memories.ts` + `recall.ts` —
   best-effort `embed([task/intent])` + read sidecar, semantic rank when both
   present, else BM25. Never throws. Real path gated `MEGA_EMBED_E2E`.
   → verify: mcp-bridge tests green; graceful fallback test passes with no model.

## Layer 1B — Wire `memoryRelevance`

5. RED: pruner/context test — approved memory's `relatedFile` fed → that file's
   block ranks up vs. without; empty memories → no-op. → verify: fails.
6. GREEN: `approvedMemoryFiles` helper in core (approved + non-stale relatedFiles;
   stale counterpart). CLI `context/shared.ts` + MCP `context-pruning.ts` call it
   instead of BM25-narrowed `searchMemoryEntries({text})`. → verify: pruner + cli
   + mcp tests green; existing context tests unbroken.

## Layer 1C — Entity layer (`@megasaver/memory-graph`)

7. RED: `build-graph` entity test — two memories sharing a `relatedSymbol` → one
   `entity` node, two `entity-mention` edges (one per memory); file entities too;
   first-writer-wins dedup. → verify: fails.
8. GREEN: add `entity` node kind + `entity-mention` edge kind to `model.ts`;
   derive entities from `relatedSymbols`/`relatedFiles` in `build-graph.ts` with
   kind-prefixed ids (`entity:symbol:` / `entity:file:`). → verify: graph tests green.

## Verify + ship

9. Per-package tests (core, memory-graph, context-pruner, mcp-bridge) + cli +
   typecheck + biome on changed files. Full `pnpm verify` green.
10. Confirm default `pnpm verify` loads no model (grep test output / no download).
11. `MEGA_EMBED_E2E=1` smoke for the gated real-embed test (best-effort).
12. Changeset (minor) for changed-public-API packages. Wiki: entities/memory
    pages + `log.md`. Commit spec(done) + impl + tests + changeset + wiki.
