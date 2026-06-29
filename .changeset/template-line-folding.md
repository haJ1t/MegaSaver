---
"@megasaver/output-filter": minor
---

feat(output-filter): template-line folding (collapseSimilar)

Add a second normalize pass that runs after `collapseRepeatedLines`. It
masks clearly-volatile tokens (ISO/clock timestamps, hex/uuid ids, ports,
byte/duration counts) to placeholders, then folds a run of consecutive
lines whose MASKED form is identical into one exemplar + a counted marker
`… [N similar: <masked template>]`, keeping the FIRST and LAST concrete
instance verbatim as boundary evidence. This catches build/install/server
log spam — lines identical except a timestamp/id — that `collapseRepeatedLines`
misses because the lines are not byte-identical.

Tool-resident (runs in both the CLI saver hook and the MCP read/run tools)
and lossless: raw output is still persisted to the ChunkSet and recoverable
via `mega_fetch_chunk`; folding only changes what is RETURNED.

Evidence-preserving (risk HIGH): masking is conservative. A line carrying
any diagnostic signal (error/fail/exception/warning/panic/fatal keyword,
a `TS####` code, or a `file:line:col` position) is never folded, and only
volatile-bearing lines are fold candidates, so two distinct errors or
diagnostics are never merged.
