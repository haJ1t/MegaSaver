---
"@megasaver/stats": minor
"@megasaver/context-gate": patch
---

Overlay savings events are idempotent under the daemon-timeout replay (B11 /
HOOK-3). `recordAndFilterOverlayOutput` derives the overlay event id from the
compression's stable inputs (workspace, session, source, mode, label, raw
content) plus a 10-minute creation bucket, so the daemon write and the hook's
in-process timeout fallback produce the SAME id for the same tool output.
`appendOverlayEvent` performs the id-existence check AND the append under the
same file lock as the summary fold (the two writers are concurrent by
construction — an unlocked check-then-append could interleave), treats a
replay as a no-op (never an error), and now returns the summary extended with
`appended: boolean` so callers gate first-sight side effects (the evidence
row) without a second ledger scan. New export `hasOverlayEvent(store,
workspaceKey, liveSessionId, eventId)` remains for read-side consumers.
Residuals, named: bucket skew (writers stamping different 10-minute buckets;
P ≈ min(1, skew/600 s), modeled, not measured) and a lock-contended append
(50 ms deadline) degrading to the unlocked check-then-append so no event is
lost. A byte-identical re-delivery in a later bucket (first-sight ledger
failing open) still counts.
