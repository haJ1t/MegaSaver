# @megasaver/shared

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- 0498b79: Add Cursor as a connector target. `agentIdSchema` widens to four
  members (adds `"cursor"`); `@megasaver/connector-generic-cli`
  ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
  and gains an optional `ConnectorTarget.header` field that the CLI
  prepends on first seed (used to write Cursor's required YAML
  frontmatter once). Existing `claude-code` and `codex` paths are
  byte-identical. `mega session create --agent cursor` and
  `mega connector sync demo --target cursor` work end-to-end.
- 4a56e4c: Initial release of `@megasaver/shared` — cross-cutting contracts package. v0.1 surface: `RiskLevel`, `AgentId`, branded entity IDs (`ProjectId`, `SessionId`, `MemoryEntryId`). Schema-first via Zod, ESM-only.

### Patch Changes

- 93840ac: Add `codex` to the `AgentId` enum so the upcoming generic-cli connector
  target can carry its own agent identity instead of collapsing into
  `generic-cli`.
