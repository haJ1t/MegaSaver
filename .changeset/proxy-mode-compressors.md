---
"@megasaver/output-filter": minor
---

Proxy Mode v1.2 Vitest + TypeScript compressors and small-output
passthrough. `compressVitest` keeps failing tests, assertions, stack
frames and the summary while collapsing passing tests; `compressTsc`
groups diagnostics by file, dedupes cascading errors and leads with a
top-files header. `filterOutput` now picks a `decision`
(`passthrough` < 1200 tokens, `light` < 2000, else `compressed`),
only running a specialized compressor (gated on
`isConfidentClassification`) and budget-fitting in the compressed
band. Thresholds are configurable; the result reports `decision`,
`compressor`, `rawTokens` and `returnedTokens` for audit, with no fake
positive savings on passthrough.
