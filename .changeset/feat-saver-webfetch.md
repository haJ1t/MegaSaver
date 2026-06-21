---
"@megasaver/connector-claude-code": patch
"@megasaver/cli": patch
---

Compress WebFetch output via the PostToolUse saver hook. `WebFetch` is added to
the saver matcher and mapped to the `fetch` source kind, and the tool-response
reader now handles WebFetch's shapes (a bare string or `{ result: string }`),
swapping in compressed text while preserving the original schema. Output that is
already small still passes through unchanged.
