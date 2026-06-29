---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/daemon": minor
"@megasaver/mcp-bridge": minor
---

feat: outline-first read mode

`mega_read_file` accepts `outline: true`: for a supported source file it
returns the file skeleton (imports + top-level signatures + line ranges +
chunk ids) and persists every body as a fetchable chunk, so an agent expands
only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
falls back to a normal read for non-source / unsupported / unparseable files.
