---
"@megasaver/core": minor
"@megasaver/cli": minor
"@megasaver/mcp-bridge": minor
---

Add an on-demand memory-index build so semantic memory recall goes live
(WS3 increment 2). `embedMemoryEntries` previously had no production
caller, so the `get_relevant_memories` coverage guard always fell back to
BM25.

- `@megasaver/core`: `buildMemoryIndex(storeRoot, projectId, entries,
  embedFn?)` — the missing caller. Reads the prior id→hash manifest,
  runs the incremental embedder (carry-forward unchanged memories), then
  rewrites the manifest. Returns `{ embedded, carried, total }`.
- `mega memory index <project>` — CLI command building the per-project
  vector sidecar on demand (loads the model; never on the save hot path).
- `mega_index_memory` — MCP tool doing the same build for an agent.

`embedFn` is injectable so the command/tool logic is tested with a
counting fake; the real model path is E2E-gated and CI stays model-free.
