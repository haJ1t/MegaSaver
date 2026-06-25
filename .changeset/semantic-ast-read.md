---
"@megasaver/output-filter": minor
---

Semantic AST chunks for file reads. For `source.kind === "file"` with a
supported extension, the read is partitioned into AST-aligned chunks
(functions/classes/declarations) via the indexer extractors instead of
naive line windows, and both the command-output compressor and dedupe are
gated out of the file path so the original file text is parsed and its
exhaustive partition reaches excerpts intact. Command, grep, and fetch
sources are byte-for-byte unchanged; unsupported extensions and parse
failures degrade to line chunking.
