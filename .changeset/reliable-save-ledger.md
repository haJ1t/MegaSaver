---
"@megasaver/core": minor
"@megasaver/evidence-ledger": patch
"@megasaver/mcp-bridge": minor
---

Reliable save: approve_memory now runs a deterministic validator (schema,
evidence-for-non-human, safe related files, bounded content, advisory
heuristics) plus a conflict checker (duplicate/supersession/contradiction)
before flipping a suggested memory to approved. Hard failures and conflicts
leave the row suggested with reasons; an exact duplicate of an approved memory
is rejected (never a second approved row); nothing auto-approves. Adds a
regression test locking that agent-facing retrieval returns approved-only memory.

Plan 3b (evidence-ports): the secret gate is now ACTIVE. approve_memory resolves
evidenceIds to real EvidenceRecord objects via @megasaver/evidence-ledger; it
rejects approval when any referenced evidence has unresolvedHighRisk (unresolved
secret finding), is revoked/tombstoned, or belongs to a different canonical
workspace (cross-workspace leak prevention, spec §6). The unresolvedSecret input
to validateSave is derived from the real redactionReport, not a false default.
