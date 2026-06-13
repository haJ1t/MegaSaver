---
"@megasaver/output-filter": minor
---

Proxy Mode v1.2 output classifier. New `classifyOutput` returns a
`{ category, confidence }` over `vitest | typescript | generic_shell |
unknown`, using both command matching and output sniffing on
ANSI-stripped text. `filterOutput` now runs the classifier after ANSI
normalization (before compressor dispatch) and surfaces the result on
`FilterOutputResult.classification` for audit/debug.
`isConfidentClassification` gates specialized compressor dispatch
(P2); low-confidence output falls back to the generic filter.
