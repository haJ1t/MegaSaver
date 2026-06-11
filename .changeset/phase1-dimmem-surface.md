---
"@megasaver/core": minor
"@megasaver/cli": minor
"@megasaver/mcp-bridge": minor
"@megasaver/connectors-shared": patch
---

Phase 1 (DIMMEM) read/write surface over the typed memory schema.

Core: `CoreRegistry` gains `updateMemoryEntry` (mutable-in-place patch,
bumps `updatedAt`, rejects immutable-field changes), `deleteMemoryEntry`
(hard delete; empties remove the project's JSONL rather than leaving a
zero-byte file), and `searchMemoryEntries` — local, offline BM25
(`@megasaver/retrieval`) over title+content+keywords with type/
confidence/scope filters, stale excluded by default, newest-first when
no text. New exports: `memoryEntryUpdatePatchSchema`,
`memorySearchQuerySchema`, `searchMemoryEntries`, `MemorySearchQuery`.

CLI: `mega memory create` gains typed flags (`--type --title --keyword
--confidence --source --reason --goal --file --expires`, all optional
with neutral defaults); new `mega memory search/update/delete/explain`
(`delete` requires `--yes`; `--json` on read commands).

MCP bridge: three new tools — `save_memory`, `search_memory`,
`get_relevant_memories` — widening the closed tool enum to seven.
