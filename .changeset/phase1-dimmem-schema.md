---
"@megasaver/core": minor
---

Phase 1 (DIMMEM) structured memory schema: `MemoryEntry` gains a typed
`MemoryType` (10 categories), `title`, normalized `keywords`,
`confidence`, `source`, `stale`, `updatedAt`, `expiresAt`, and optional
`reason`/`goal`/`evidence`/`relatedFiles`/`relatedSymbols`. New exports
`memoryTypeSchema`, `memoryConfidenceSchema`, `memorySourceSchema`, and
`backfillMemoryEntry` (read-boundary upgrade of v0.1 rows — idempotent).
The JSON-directory read path backfills legacy memory JSONL so existing
stores keep loading. `mega memory create` and the GUI memory route emit
the new typed shape with neutral defaults; typed `--type`/`--title`
flags and search/update/delete/explain land in follow-up slices.
