---
"@megasaver/evidence-ledger": patch
"@megasaver/content-store": patch
"@megasaver/context-gate": patch
---

Scope chunk-set deletion and retention holds by `(workspaceKey, session, chunkSetId)`.

The saver derives chunk-set ids from the output's sha256 with no session or
workspace salt, so two sessions that produce byte-identical output write the
same filename in different directories. The evidence sweep still resolved "which
file to delete" with `locateChunkSet`, a store-wide first-match scan — so the
daily, unattended GC could delete a live session's (or another repo's) raw
output while the expired record's own copy survived, leaving the ledger claiming
`available` over a file that was gone. The retention pin walker had the mirror
defect: holds keyed by the bare id let one workspace's pin retain another
workspace's expired chunk forever.

`ChunkDeletePort` now takes a `ChunkRef { workspaceKey, sessionRef, chunkSetId }`
(the evidence record already carried all three), and `sweepEvidenceStore` deletes
only at that path — an unscopable ref is skipped rather than searched for.
`pruneOlderThan` takes `keepChunkSetKeys` built from the new exported
`chunkSetKey`, matched against the same triple; an unscopable hold falls back to
the bare id and over-retains. `locateChunkSet` keeps serving reads only —
colliding sets are byte-identical, so any match answers a read.

The triple addresses the FILE, not its owner: several records in one session can
point at one chunk file, so `gcEvidence` also skips the unlink when any record
that survives the pass (pinned, manual_hold, or unexpired) still points at that
address. It already lists every record in the workspace, so the check is a set
lookup. The expiring record is still degraded to `retained_metadata_only`.

Breaking (pre-1.0, no shim): `ChunkDeletePort` takes a ref, not a string;
`pruneOlderThan`'s `keepChunkSetIds` is now `keepChunkSetKeys`.
