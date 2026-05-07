---
"@megasaver/connector-claude-code": minor
---

Refactor `@megasaver/connector-claude-code` to delegate render, parse,
upsert, remove, and filesystem operations to
`@megasaver/connectors-shared`. Rendered block is byte-identical
(regression test asserts).

BREAKING (input shape): `ClaudeCodeContextSchema` now requires a
top-level `agentId: "claude-code"` field — previously the agent
identity was hardcoded inside the renderer and the schema only
validated `{ project, session, memoryEntries }`. Callers constructing
a `ClaudeCodeContext` literal must add `agentId: "claude-code"`. All
exported function names and rendered output remain unchanged.
