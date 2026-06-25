---
"@megasaver/output-filter": minor
---

Add semantic AST chunking for file reads. For a supported source file
(.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs, .md, .json) the chunker now
produces AST-aligned chunks (functions, classes, headings, JSON keys)
instead of fixed 40-line windows, so ranking and budgeting operate on
whole declarations. The whole file is exhaustively partitioned
(gap-filled, oversized blocks sub-split) and a parse failure or
unsupported extension falls back to line chunking. The command-output
compressor and dedupe are skipped for file reads so the original file
text is parsed and the semantic partition survives intact. Command,
grep, and fetch sources are unchanged.
