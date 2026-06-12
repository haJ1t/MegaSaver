---
"@megasaver/output-filter": minor
---

Proxy Mode v1.2 replay trace. With `recordTrace`, `filterOutput`
emits a `trace` capturing the classification, decision, compressor,
engine-ranking flag, token estimates, and candidate/selected/omitted
chunk references with scores and signal values — no raw text
(privacy §12.3). `finalizeReplayTrace` wraps it with
session/project/tool/query and the content-store `chunkSetId` for
offline replay; `writeReplayTrace` appends it best-effort as JSONL.
Captures enough to drive the v1.4 ablation ladder without duplicating
stored output.
