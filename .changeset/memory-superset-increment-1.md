---
"@megasaver/core": minor
"@megasaver/memory-graph": minor
"@megasaver/mcp-bridge": minor
---

Memory superset increment 1: semantic recall + entity graph +
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
