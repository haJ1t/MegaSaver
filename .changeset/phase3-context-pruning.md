---
"@megasaver/context-pruner": minor
"@megasaver/cli": minor
"@megasaver/mcp-bridge": minor
---

Phase 3 (Context Pruning / LAMR): new `@megasaver/context-pruner`
package — task-aware selection that scores the Phase 2 `CodeBlock` index
with an 8-factor model (semantic BM25, userMention, testFailure,
recentEdit, memory, dependency; stale/noise penalties), selects a
6–8-block context pack under a token budget with dependency closure
(never silently dropping a named/failing-test block), and emits per-block
reasons + a savings audit. CLI gains `mega context
build/explain/audit/export`; the MCP bridge gains `get_relevant_context`,
`get_relevant_code_blocks`, `explain_context_selection`, and
`get_context_budget_report`. Memory relevance is passed in as data
(no `@megasaver/core` edge); leaf package depends only on indexer +
retrieval + shared.
