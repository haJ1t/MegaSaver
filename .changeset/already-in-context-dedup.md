---
"@megasaver/content-store": minor
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
---

feat: per-session already-in-context dedup

Suppress an excerpt whose exact text was already returned to the model
earlier in the same session (any read, command, or grep) and reference the
prior chunk-set instead, so identical text is not billed twice. New
per-session shown-index.json sibling index; evidence stays recoverable via
the referenced chunk-set (lossless expand).
