---
"@megasaver/connector-claude-code": patch
---

Refactor `@megasaver/connector-claude-code` to delegate render, parse,
upsert, remove, and filesystem operations to
`@megasaver/connectors-shared`. Public surface and rendered block are
unchanged (regression test asserts byte-identical output).
