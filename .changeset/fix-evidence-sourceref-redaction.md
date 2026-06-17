---
"@megasaver/evidence-ledger": patch
"@megasaver/context-gate": patch
"@megasaver/mcp-bridge": patch
---

Defense-in-depth security hardening (PR #146 follow-up)

**evidence-ledger / context-gate**: `appendEvidence` now requires a `redactSourceRef`
port (compile-time fail-closed: every caller must wire it). The port is applied to
`sourceRef` before schema parse, so the stored record can never contain an
unredacted secret-bearing field. `context-gate/record-output` wires
`policyRedactSourceRef` which runs `@megasaver/policy` redact over
command/args/url/query/path/label (hookTool left as-is — it's a tool name, not
secret-bearing).

**mcp-bridge**: The server-owned expansion-guard `Set<string>` is replaced with a
FIFO-bounded `BoundedSet(EXPANSION_GUARD_CAP)` (cap = 4096). A long-lived server
process can no longer grow the allowed-chunkSet set without bound. Per-session
keying is deferred: `mega_fetch_chunk` args carry no `sessionId`, so keying by
session would require a breaking wire-protocol change; stdio MCP is single-session-
per-process in practice.
