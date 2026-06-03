# @megasaver/content-store

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- a8b6531: Add the `@megasaver/content-store` package: ChunkSet persistence for
  the context-gate pipeline. Stores one JSON file per chunkSet under
  `<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json` with an
  in-package atomic write (temp + fsync + rename, POSIX dir-fsync,
  symlinked-parent refusal). Public surface: `saveChunkSet`,
  `loadChunkSet`, `listChunkSets`, `deleteChunkSet`, and an injected-clock
  `pruneOlderThan`, plus the `chunkSet`/`chunk` Zod schemas and a closed
  `contentStoreErrorCodeSchema` enum. The store root is injected by the
  caller; content-store never imports `@megasaver/core` (cycle guardrail).
  The `redacted` flag is persisted verbatim and round-trips intact.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [ae41534]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/output-filter@1.0.0
