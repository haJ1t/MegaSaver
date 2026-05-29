---
"@megasaver/content-store": minor
---

Add the `@megasaver/content-store` package: ChunkSet persistence for
the context-gate pipeline. Stores one JSON file per chunkSet under
`<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json` with an
in-package atomic write (temp + fsync + rename, POSIX dir-fsync,
symlinked-parent refusal). Public surface: `saveChunkSet`,
`loadChunkSet`, `listChunkSets`, `deleteChunkSet`, and an injected-clock
`pruneOlderThan`, plus the `chunkSet`/`chunk` Zod schemas and a closed
`contentStoreErrorCodeSchema` enum. The store root is injected by the
caller; content-store never imports `@megasaver/core` (cycle guardrail).
The `redacted` flag is persisted verbatim and round-trips intact.
