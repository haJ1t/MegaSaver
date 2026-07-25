---
"@megasaver/output-filter": patch
---

Replace `dedupe()`'s all-pairs simhash scan with a pigeonhole-banded lookup.

Every chunk was compared against every kept hash with a 64-iteration BigInt
Hamming loop, and nothing caps chunk count ahead of it: the read path reads a
file whole and the saver hook passes its payload straight in, at 40 lines per
chunk. High-entropy output (build logs, CSV, hex dumps) has no duplicates, so
every chunk survives and the scan runs at full length while folding nothing.
The MCP tool call / PostToolUse hook blocks for the whole time.

The 64-bit simhash is now split into `HAMMING_DEDUPE_THRESHOLD + 1` bands of 16
bits. Two hashes within the threshold must share a whole band, so only
band-mates need a Hamming compare. The kept set is unchanged — a test pins it
against a brute-force all-pairs reference on a corpus with real folds.

Measured through `filterOutput` on 128k lines (1.1 MB) of high-entropy output,
3,200 chunks, node v25.8.2: **6.8-7.7 s before, 0.32 s after** (the rest of the
pipeline alone is 0.13 s).
