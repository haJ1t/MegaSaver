---
"@megasaver/output-filter": patch
---

semantic AST chunker: drop pure-whitespace gap chunks from the partition. Blank
separators between declarations no longer become empty excerpts that pollute the
ranked output (in a 40-function sample, 51 excerpts → 12, all non-empty).
Function blocks and content gaps are unaffected; every non-blank line stays
covered by exactly one chunk.
