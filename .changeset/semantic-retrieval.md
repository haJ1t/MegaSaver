---
"@megasaver/indexer": minor
"@megasaver/context-pruner": minor
"@megasaver/mcp-bridge": minor
---

WS1 hybrid BM25 + embeddings retrieval, additive over BM25 with graceful
BM25-only fallback when vectors/model are absent.

- indexer: `buildIndex`/`buildWorkspaceIndex` gain an opt-in `embeddings?`
  flag (default false) and now return `Promise<BuildResult>`; when true they
  write an `embeddings.jsonl` sidecar next to `blocks.jsonl`, carrying
  unchanged-block vectors forward via the incremental contentHash skip.
  `searchBlocks` accepts optional pre-computed `{ taskVector, blockVectors }`
  and cosine-reranks the BM25 hits when present.
- context-pruner: `scoreBlocks` stays synchronous and gains an
  `embeddingRelevance` factor consuming pre-computed `taskVector` /
  `blockVectors` (0 when absent); new `embedding` weight; the factor is added
  to `scoreFactorsSchema`.
- mcp-bridge: the context-pruning tool best-effort loads the sidecar and
  embeds the task at the boundary, passing vectors into the pack; its handlers
  are now async. Default builds download no model — the embed path is opt-in
  and gated.
