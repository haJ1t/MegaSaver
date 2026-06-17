---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
---

Reliable save: approve_memory now runs a deterministic validator (schema,
evidence-for-non-human, safe related files, bounded content, advisory
heuristics) plus a conflict checker (duplicate/supersession/contradiction)
before flipping a suggested memory to approved. Hard failures and conflicts
leave the row suggested with reasons; an exact duplicate of an approved memory
is rejected (never a second approved row); nothing auto-approves. NOTE: the
unresolved-secret check is wired but its input is supplied by the evidence
ledger (Plan 3b) — until then it defaults false, so the secret gate is inert in
this release; the evidence-presence gate is fully active. Adds a regression test
locking that agent-facing retrieval returns approved-only memory.
