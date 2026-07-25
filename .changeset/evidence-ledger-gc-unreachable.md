---
"@megasaver/context-gate": patch
"@megasaver/evidence-ledger": patch
"@megasaver/cli": patch
---

Make evidence-ledger GC actually collect. `gcEvidence` was dead code in two
independent ways: nothing outside the package ever called it, and every record
the saver writes was stamped `expiresAt: null`, which its own loop skips. One
evidence record per compressed tool output therefore accumulated forever, each
one carrying a `returnedChunkRefs` entry per 40-line chunk of the *full* raw
output, pretty-printed. Meanwhile the chunk set those refs point at is deleted
by the content-store prune after 30 days, so the store filled with permanently
dangling evidence — and `/api/claude-sessions/:dir/:id/memory/graph` re-reads,
`JSON.parse`es and zod-parses every one of them on each request.

Measured on a 348,889-byte command output (1,000 chunks, `mode: "aggressive"`):
the evidence record is **96,932 bytes** — 28% of the raw output it describes —
and before this change it stayed 96,932 bytes forever. After the retention
window it is now degraded to **1,120 bytes**, an 86x drop, and its chunk set is
deleted.

Three parts, all at the single site each concern routes through:

- `@megasaver/context-gate` — the only production writer of evidence
  (`recordAndFilterOverlayOutput`) now stamps `expiresAt` at
  `createdAt + EVIDENCE_RETENTION_MS` (30 days), the same clock the content
  store prunes overlay chunk sets on, so a record cannot outlive the chunks it
  references.
- `@megasaver/context-gate` — new `sweepEvidenceStore`, a store-wide wrapper
  over the per-workspace `gcEvidence` that resolves each record's chunk set via
  `locateChunkSet` and deletes it through `deleteOverlayChunkSet`. It lives
  here, not in the CLI, because the CLI must not depend on
  `@megasaver/evidence-ledger` directly.
- `@megasaver/cli` — the existing daily throttled `maybeRunOverlayGc` hook now
  calls `sweepEvidenceStore` alongside the chunk/intent/seen sweeps.
  Best-effort: a failure never fails the GC pass.
- `@megasaver/evidence-ledger` — degrading a record to
  `retained_metadata_only` now also clears `returnedChunkRefs`. Every ref
  pointed into the chunk set just deleted, and on a large output they are
  ~99% of the record's bytes — they account for the whole 96,932 → 1,120
  collapse above.

Retention exemptions are unchanged: `pinned` and `manual_hold` records still
survive ordinary GC.
