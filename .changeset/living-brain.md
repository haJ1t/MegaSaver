---
"@megasaver/core": minor
"@megasaver/connectors-shared": minor
---

Living Brain (i1): auto-superseding memory save path with lineage recall and
time-travel queries.

- core: new `supersession` module — `detectSupersession` (lexical
  checkConflicts ladder + best-effort cosine overlay), the extracted
  `applySupersession` close, `buildLineage`, `changedFromFor`, and the single
  write entry point `saveMemoryWithLineage` with a born-approved close ladder.
  Optional `lastActiveAt` on the memory schema; `effectiveConfidence` decay
  rekeys to `lastActiveAt ?? updatedAt ?? createdAt` (legacy rows rank
  bit-identically). Warm-start briefs carry a `(was: … until …)` suffix.
- connectors-shared: `ConnectorContext` gains an optional `memoryChangedFrom`
  record; its titles are sentinel-guarded, and the connector block renders a
  `(changed from …)` suffix. Closed/archival memories stop rendering in the
  connector block (validity gate).
