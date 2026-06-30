---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/daemon": minor
"@megasaver/cli": minor
---

Add bi-temporal valid-time to memories (M1). `MemoryEntry` (and the
overlay variant) gain optional, backward-compatible `validFrom` /
`validTo` (valid time, alongside the existing `createdAt` / `updatedAt`
transaction time) and `supersedesId`. New `isCurrent(memory, asOf)` and
`isRecallable(memory, asOf)` helpers: `isRecallable` is the single shared
recall predicate (approved AND currently valid) that every recall surface
routes through — BM25 + semantic search, the MCP `recall` tool, the
daemon recall handler, and the GUI connector-context builder — so the
bi-temporal filter cannot drift between surfaces. `searchMemoryEntries`
and `searchMemoryEntriesSemantic` filter to currently-valid memories and
accept an optional `asOf` for time-travel ("what did we believe as of
T"); the MCP `recall` / `get_relevant_memories` tools and the daemon
recall route thread `asOf`. `save_memory` accepts `supersedesId`.
Approving a memory that supersedes an older one closes the old memory's
`validTo` (it drops out of default recall but is kept for time-travel —
lossless); the supersede target is validated (same project + scope,
not self, must exist) so an agent-controlled `supersedesId` cannot close
a memory it should not touch or vanish itself. The CLI/GUI memory graphs
emit a `supersede` edge from the recorded `supersedesId`. Rows without
temporal fields are treated as current, so existing stores load
unchanged.
