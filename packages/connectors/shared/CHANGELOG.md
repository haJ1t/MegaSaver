# @megasaver/connectors-shared

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

- a3a4401: Initial publish of `@megasaver/connectors-shared`. Provides the
  canonical block render/parse/upsert/remove helpers, the
  `ConnectorContext` schema, and target-agnostic filesystem helpers
  shared by every Mega Saver connector.

### Minor Changes

- 0c30651: Ship the final AA1 epic surface (BB11): GUI AgentSetupDoctor + connector
  CONTEXT_GATE block.

  `@megasaver/connectors-shared` gains `renderContextGateBlock` (rendered only
  when `session.tokenSaver?.enabled === true`) plus the `MEGA SAVER:CONTEXT_GATE`
  sentinel constants. `parseBlock(content, sentinels?)` is now parameterised by
  sentinel pair (defaulting to the legacy pair, so every existing caller is
  byte-unaffected) and `upsertBlock` manages the legacy + CONTEXT_GATE blocks in
  one pass.

  `@megasaver/mcp-bridge` hoists `DEFAULT_MCP_COMMAND` / `DEFAULT_MCP_ARGS`
  (`mega` + `["mcp","serve"]`) and threads an optional `args` through
  `buildMcpSetupOps` so the written MCP config is a runnable launch command.

  `@megasaver/gui` adds the Agent setup view (`agent-setup-doctor` +
  `agent-setup-row`), four zod-validated bridge routes under `/api/mcp/*`
  (status/install/repair/uninstall) consuming BB8's `McpSetupOps`, the
  `mcp_setup_failed` bridge error code, api-client methods, and the
  `agent-setup` nav tab. The GUI bridge now writes a runnable `mega mcp serve`
  launch command on install.

  `@megasaver/cli` connector-sync now seeds a brand-new agent file via
  `upsertBlock` (so it also receives the CONTEXT_GATE block when the session has
  Mega Saver Mode enabled); output stays byte-identical for tokenSaver-off
  sessions.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/core@1.0.0
