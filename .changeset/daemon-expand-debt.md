---
"@megasaver/daemon": patch
"@megasaver/context-gate": minor
---

The daemon's POST /expand now records the B3 expansion-debt event (S2-3).
The route called `fetchOverlayChunk` directly, bypassing the recovery-debt
append that every other recovery route performs, so daemon-mediated
expansions were invisible to the net ledger and to the recovery rate R.
New context-gate export `recordOverlayExpansionDebt` charges the debt to the
exact (workspaceKey, liveSessionId) named in the request — not a
locateChunkSet resolution, which could bill another session holding the same
content-addressed chunk-set id; `fetchChunk`'s overlay branch now delegates
to the same recorder.
