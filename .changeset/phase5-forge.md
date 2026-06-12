---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 5 — FORGE failed-run learning. Adds failure-similarity search,
convert-failure-to-rule (caller-supplied insight; engine does linkage,
evidence seeding, and the convertedToRule flip atomically), and scored
applicable-rule retrieval. New: 2 pure ranking modules + 3 CoreRegistry
methods (updateFailedAttempt, searchFailedAttempts, convertFailureToRule),
3 MCP tools (convert_failure_to_rule, find_similar_failures,
get_applicable_rules; bridge now 18 tools), and CLI (mega fail, mega rules,
mega learn from-failure). No LLM, no embeddings — reuses rankBm25.
