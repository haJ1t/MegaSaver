---
"@megasaver/output-filter": patch
---

`countTokens` no longer stalls on highly repetitive input. js-tiktoken's
`encode` degrades on long runs of *repeated* characters, not on run length as
such — measured on this machine: 60 KB of unbroken hex 9 ms, 64 KB of
space-free JSON 33 ms, `"X".repeat(50000)` **90,790 ms**. `countTokens` now
scans for the longest whitespace-delimited run and, only past `MAX_SAFE_RUN`
(2000 chars), encodes in 1000-char chunks; ordinary text takes the whole-string
path unchanged. Chunking costs accuracy at the boundaries, measured against
whole-string counts as 0.00% on code, 0.00% on prose, 0.20% on JSON and 0.05%
on base64. That error is **not** neutral: `rawTokens` is the larger text and so
the one that chunks, while the smaller `returnedTokens` usually does not, which
biases `deltaTokens` upward — the guard inflates reported savings rather than
understating them. The saver's own end-to-end suite went from 467 s to 12.0 s.
