---
"@megasaver/output-filter": patch
"@megasaver/cli": patch
---

Never blind the model on zero excerpts. A specialized compressor could empty its
input (misclassified output whose pattern never matches, e.g. grep results flagged
as typescript), or every chunk could exceed the byte budget — both returned zero
excerpts, leaving the model only a "0 kept" summary. `filterOutput` now applies a
no-blind floor: when the compressed path yields no excerpts it re-chunks the
normalized (uncompressed) output generically and keeps the top-ranked content
within budget, truncating the single top chunk when even one chunk overflows.
`fitBudget` keeps its byte-budget semantics; the floor lives in the pipeline.
