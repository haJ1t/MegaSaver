---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 10 (Team/Cloud — local slice): memory approval workflow.
`MemoryEntry` gains `approval` (`suggested | approved | rejected`);
`backfillMemoryEntry` defaults existing rows to `approved` (backward
compat). Agent `save_memory` writes default to `suggested`, human
`mega memory create` to `approved`. `suggested`/`rejected` memory is
gated out of connector sync, memory search / relevant-memories /
context packs, and the MCP `get_project_context` / `mega_recall` tools —
only approved memory is shared with agents/teammates. New: `mega memory
approve|reject`, `--all` review, the `approve_memory` MCP tool (24 → 25),
`buildPrMemoryComment` + `mega github pr-comment`. Team-shared memory =
a shared `--store` path + the approval gate. Hosted cloud sync, auth,
private deployment, org rules, hosted audit, and a web approval UI are
explicitly deferred.
