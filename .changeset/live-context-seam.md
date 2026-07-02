---
"@megasaver/core": minor
"@megasaver/shared": minor
"@megasaver/mcp-bridge": minor
"@megasaver/context-gate": minor
---

Live Context Seam: capture agent failures as first-class evidence and feed them
back into the next task's context selection, closing the loop between what an
agent got wrong and what it sees on the retry.

- `@megasaver/shared`: new `sessionFailureIdSchema` — the branded id boundary for
  a persisted failure record, so a failure id is validated once at the edge and
  trusted internally thereafter.
- `@megasaver/core`: new `SessionFailure` type plus registry methods
  `createSessionFailure(input)` and `listSessionFailures(query)`. Failures are
  stored alongside sessions with the same metadata discipline as memory
  (source, timestamp, scope), and `listSessionFailures` is the read side the
  ranking path consumes.
- `@megasaver/context-gate`: failure capture wires recorded `SessionFailure`
  rows into the gate, and failure-aware ranking boosts files/blocks implicated
  in recent failures so a retry surfaces the evidence the last attempt missed.
  Additive — with no recorded failures the ranking is byte-identical to today.
- `@megasaver/mcp-bridge`: new `get_task_context` MCP tool exposes the
  failure-aware context selection to connected agents, returning the ranked
  context for a task including any failure-boosted evidence.
