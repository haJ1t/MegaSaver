---
"@megasaver/evidence-ledger": minor
---

Add @megasaver/evidence-ledger: canonical evidence schema with revoke/pin
invariants, append-only store with in-record audit transitions, ledger-computed
post-redaction digests, pin/unpin session round-trip, best-effort revocation
(tombstone-before-delete: null digests + null chunk ref + scrubbed sourceRef +
cleared pins, then ChunkDeletePort delete), and retention GC that degrades to
metadata-only while exempting pinned + manual_hold. No @megasaver/core or
content-store dependency.
