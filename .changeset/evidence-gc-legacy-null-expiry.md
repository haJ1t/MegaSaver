---
"@megasaver/evidence-ledger": patch
"@megasaver/context-gate": patch
---

Collect the evidence records that were already on disk. The previous fix
stamped `expiresAt` on new writes only, so every record the saver had written
before it — one per compressed tool output, each carrying a
`returnedChunkRefs` entry per 40-line chunk of the full raw output — kept
`expiresAt: null`, which `gcEvidence` reads as "never expires" and skips.
`maybeRunOverlayGc` therefore swept those stores daily and degraded nothing:
the records stayed `available` with refs dangling into chunk sets the
content-store prune had already deleted, and the GUI memory-graph route kept
`JSON.parse`ing and zod-parsing all of them on every request — the exact bloat
the previous changeset claimed to fix, untouched on every pre-existing store.

`gcEvidence` now takes an optional `fallbackExpiryMs`: when a record has no
`expiresAt`, it expires at `createdAt + fallbackExpiryMs`. `sweepEvidenceStore`
passes `EVIDENCE_RETENTION_MS`, so legacy rows age out on the same 30-day clock
as the ones written after the fix. The window is a caller-supplied policy, not
a ledger default — the ledger owns no retention policy (the same reason
redaction is a port) and a direct caller that passes nothing still sees the
documented "null means no expiry". Retention exemptions are unchanged: `pinned`
and `manual_hold` are skipped before expiry is considered, and a legacy record
still inside the 30-day window keeps its chunk set.
