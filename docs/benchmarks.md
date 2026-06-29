# Mega Saver Benchmarks

Measured on real product code against real inputs. Numbers come from
`filterOutput`'s own `rawTokens` / `returnedTokens` fields — no
synthetic inflation. Your mileage varies by input shape.

All results are **evidence-preserving**: nothing is discarded. The full
raw output is stored as a ChunkSet and recoverable via `proxy_expand_chunk`
or `mega output chunk`.

## Results

| Scenario | Raw tokens | Returned tokens | Saving |
|----------|-----------|----------------|--------|
| Diff on re-read (unchanged file) | 10,223 | 0 | 99.8% |
| `compressJson` — 1,000-object array | 89,864 | 384 | 99.6% |
| `mega_recall` — reload 4-file session context | 29,573 | 590 | 98.0% |
| `collapseSimilar` — noisy timestamped log (after timestamp-fold fix) | varies | ~3% of raw | ~97% |
| Shown-index dedup — repeated read of already-indexed file | varies | ~1.6% of raw | ~98.4% |
| Semantic repo index search | 1,227 | 36 | 97.1% |
| `compressVitest` — real run with failures | 14,926 | 674 | 95.6% |
| Outline-first read — 633-line source file | 5,417 | 291 | 94.6% |
| `stacktrace` — deep Node.js trace | 9,340 | 668 | 93.0% |
| `compressTsc` — extended diagnostics noise stripped | varies | varies | ~82% |
| `mega_impact` blast-radius vs reading caller files | varies | ~53% of raw | ~47% |

## Notes on each scenario

**Diff on re-read (99.8%):** A file you already read this session, unchanged,
returns a `[unchanged]` marker. Zero re-transmission cost; prior version
remains expandable.

**`compressJson` (99.6%):** Large JSON arrays are collapsed to a representative
sample plus a count. The full array remains in the ChunkSet.

**`mega_recall` (98.0%):** Instead of re-reading 4 source files from disk
(29,573 tokens), `mega_recall` returns a compressed session digest (590 tokens)
— recent tool calls, working intent, and key findings. Equivalent information,
50× smaller.

**`collapseSimilar` / noisy logs (~97%):** Runs of near-identical log lines
(e.g., timestamped heartbeats, repeated retries) are folded into a `[N similar
lines]` entry. The timestamp-fold fix ensures lines that differ only by
timestamp are treated as similar, not distinct.

**Shown-index dedup (~98.4%):** When the agent has already seen a file's index
entry in this session, subsequent reads skip the full skeleton and return a
`[already indexed]` pointer.

**Semantic index search (97.1%):** `mega index search` retrieves only the
matching function/class blocks from the AST index (36 tokens) rather than
returning the whole file (1,227 tokens).

**`compressVitest` (95.6%):** Test run output with real failures is compressed
to: first failure detail + test-count summary. All distinct error messages and
stack frames are preserved; pass-noise is dropped.

**Outline-first read (94.6%):** A 633-line TypeScript file returns a structural
skeleton (function signatures, class names, export list) at 291 tokens. The
agent can request specific sections via `proxy_expand_chunk` if the outline
is insufficient.

**`stacktrace` (93.0%):** Deep Node.js stack traces are trimmed to the
application frames; Node internals and repeated `node_modules` frames are
collapsed.

**`compressTsc` (~82%):** TypeScript `--extendedDiagnostics` noise (file
counts, timing) is stripped. All distinct type errors and their locations are
preserved.

**`mega_impact` blast-radius (~47% saving):** Instead of reading every caller
file to understand the impact of a change, `mega_impact` pre-filters to the
relevant caller excerpts, saving roughly half the tokens vs naive file reads.

## Methodology

Numbers are read directly from `filterOutput`'s structured result fields
(`rawTokens`, `returnedTokens`) in the product's own integration tests and
smoke runs. Token counts use the same approximation the pipeline uses
(~4 bytes/token). No external benchmark harness — the product measures
itself.
