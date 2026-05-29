---
"@megasaver/output-filter": minor
---

Add the `@megasaver/output-filter` package: an evidence-preserving
output filter pipeline (normalize, chunk, dedupe via SimHash, rank,
summarize, fit-to-budget) plus a `resolveSafeReadPath` sandbox gate.
Parsers for stack traces, test output, and TS diagnostics keep the
high-signal evidence agents need while dropping noise, so we cut
tokens without blinding the model. Public surface re-exported from
`index.ts` with a closed `outputFilterErrorCodeSchema` enum.
