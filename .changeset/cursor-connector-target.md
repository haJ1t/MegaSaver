---
"@megasaver/shared": minor
"@megasaver/connector-generic-cli": minor
"@megasaver/cli": patch
---

Add Cursor as a connector target. `agentIdSchema` widens to four
members (adds `"cursor"`); `@megasaver/connector-generic-cli`
ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
and gains an optional `ConnectorTarget.header` field that the CLI
prepends on first seed (used to write Cursor's required YAML
frontmatter once). Existing `claude-code` and `codex` paths are
byte-identical. `mega session create --agent cursor` and
`mega connector sync demo --target cursor` work end-to-end.
