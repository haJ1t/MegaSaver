---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/content-store": minor
---

diff-on-reread (suppression-only): re-reading an unchanged file in the same
session returns an `unchanged: { priorChunkSetId }` marker with empty
excerpts and skips re-filtering + re-persisting. Lossless — the prior
chunk-set is recoverable via expand. Adds FilterOutputResult.unchanged +
unchanged-marker decision (output-filter); readRaw / filterRaw / read-index
exports (context-gate); exports atomicWriteFile + read-index-tolerant
listChunkSets / READ_INDEX_FILENAME (content-store).

No @megasaver/daemon or @megasaver/mcp-bridge bump — passthrough only,
confirmed by T11.
