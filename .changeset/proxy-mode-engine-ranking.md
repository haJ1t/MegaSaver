---
"@megasaver/output-filter": minor
---

Proxy Mode v1.2 narrow engine-aware ranking. `applyEngineRanking`
re-weights the existing `scoreChunk` output (no second scorer):
normalized base relevance plus memory and failure-history boosts,
combined `0.70 / 0.15 / 0.15`, all signals in `[0,1]`. Gated behind
`MEGASAVER_ENGINE_RANKING` (off by default; injectable via
`filterOutput({ engineRanking })`). Each ranked chunk carries an
`engine` explanation (base/memory/failure/final) surfaced on excerpts
for audit and the v1.4 replay trace. `SessionHints.recentFailures`
feeds the failure-history boost.
