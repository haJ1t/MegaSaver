---
"@megasaver/output-filter": patch
---

Five evidence-honesty repairs from the 2026-07-31 audit. (1) All counted
evidence markers (prose/json/vitest/tsc/diff, not just normalize's two forms)
are reserved ahead of score in `fitBudget` via a shared `EVIDENCE_MARKER`
grammar, so count evidence can no longer vanish under budget pressure.
(2) `dedupe()` runs only in the compressed band — passthrough/light bands
really do keep every chunk — and its folds are counted in `droppedCount`.
(3) Within a near-duplicate cluster the highest-scored member survives
(ties → earlier), so a later error-bearing duplicate no longer loses to an
earlier boring line. (4) The outline branch counts its own summary into
`returnedBytes`/`returnedTokens` (M13). (5) `parseGoTest` reports what it
omits — passing blocks and preamble produce a counted, non-droppable marker
chunk and feed `droppedCount` — instead of dropping them silently.
