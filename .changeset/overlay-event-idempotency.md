---
"@megasaver/stats": minor
"@megasaver/context-gate": patch
---

Overlay savings events are idempotent under the daemon-timeout replay (B11 /
HOOK-3). `recordAndFilterOverlayOutput` derives the overlay event id from the
compression's stable inputs (workspace, session, source, mode, label, raw
content) plus a 10-minute creation bucket, so the daemon write and the hook's
in-process timeout fallback produce the SAME id for the same tool output;
`appendOverlayEvent` treats a second append with an already-recorded id as a
no-op (never an error), and the evidence row is written only on first sight.
New export `hasOverlayEvent(store, workspaceKey, liveSessionId, eventId)`
lets writers distinguish first sight from replay. A byte-identical re-delivery
in a later bucket (first-sight ledger failing open) still counts.
