---
"@megasaver/output-filter": minor
---

Add the structured-data schematizer (`compressJson`) output compressor. A
large homogeneous JSON array (> 20 same-shape objects) is collapsed to its
inferred schema (key list + sampled value types) plus the first 3 and last 1
elements verbatim and a `… [N more of same shape]` marker. Keys matching the
intent signal are force-kept in the schema. Small, heterogeneous, non-array,
and malformed JSON fall through unchanged. Lossless — raw output is still
persisted to the ChunkSet and recoverable via `mega_fetch_chunk`.

Adds a `structured` member to `OutputCategory` and `CompressorName`, a `path`
field to `ClassifyInput`, and an optional `intent` argument to
`compressByCategory`. The structured compressor is exempt from the
file-source semantic-chunking guard so `*.json` reads are schematized.
