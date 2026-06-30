---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Add bi-temporal valid-time to memories (M1). `MemoryEntry` (and the
overlay variant) gain optional, backward-compatible `validFrom` /
`validTo` (valid time, alongside the existing `createdAt` / `updatedAt`
transaction time) and `supersedesId`. New `isCurrent(memory, asOf)`
helper drives current-by-default recall: `searchMemoryEntries` and
`searchMemoryEntriesSemantic` now filter to currently-valid memories and
accept an optional `asOf` for time-travel ("what did we believe as of
T"). The MCP `recall` / `get_relevant_memories` tools thread `asOf`;
`save_memory` accepts `supersedesId`. Approving a memory that supersedes
an older one closes the old memory's `validTo` (it drops out of default
recall but is kept for time-travel — lossless), and the CLI/GUI memory
graphs emit a `supersede` edge from the recorded `supersedesId`. Rows
without temporal fields are treated as current, so existing stores load
unchanged.
