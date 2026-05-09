---
"@megasaver/cli": minor
---

Add `mega memory create/list/show` subcommands as a thin CLI layer
over the existing `CoreRegistry.{createMemoryEntry,getMemoryEntry,
listMemoryEntries}` surface. Append-only ledger; no `delete` or
`update`. `--content` rejects empty / control-char / multi-line at
the CLI boundary via a new `contentSchema` (mirrors `titleSchema`).
Cross-field guard: `--scope project` rejects `--session`;
`--scope session` requires `--session <uuid>`. `mega connector
sync` / `status` continue to pass `memoryEntries: []` to
`buildConnectorContext` — wiring to read real entries is a
separate slot.
