---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/content-store": minor
---

Add per-session already-in-context dedup to the registry read pipeline.
When `runOutputPipeline` is about to return an excerpt whose exact text
was already shown earlier this session (recorded in a new sibling
`shown-index.json`), the excerpt is dropped from the inline result and
referenced via its prior chunk-set id instead — so identical text is not
billed twice. Dedup runs after the chunk-set is persisted, so every
suppressed excerpt remains recoverable via the referenced chunk-set
(evidence-preserving). Adds an optional `deduped` field to
`FilterOutputResult` and a `SHOWN_INDEX_FILENAME` constant to
content-store (skipped when listing chunk-sets).
