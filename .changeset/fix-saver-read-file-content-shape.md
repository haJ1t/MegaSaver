---
"@megasaver/cli": patch
---

Compress the real Claude Code Read output shape.

Claude Code's Read tool delivers the file body at
`tool_response.file.content`, but `readOutputShape` only matched a
top-level `content` string/array, so every real Read result silently
passed through uncompressed — the largest outputs (whole files) saved
nothing. `readOutputShape` now handles the `{ type, file: { content } }`
shape, swapping `file.content` while preserving the surrounding file
metadata.

Also adds unit coverage for the captured real `tool_response` shapes of
Read, Grep (content mode → compresses) and Glob (filename list →
evidence-preserving passthrough, never compressed). LS is not a real
Claude Code tool, so the matcher entry is inert.
