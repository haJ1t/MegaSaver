# @megasaver/mcp-bridge

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

- 0e9be7a: BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
  mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
  widened to 16 members, McpToolName closed enum, the
  `mega mcp install/repair/serve/status/uninstall` CLI, and the
  `McpSetupOps` facade (with `aggregateMcpStatus` reporting
  `mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
  per agent) wired into the GUI bridge as the production `mcpOps`.
  Replaces the v0.3 not_implemented placeholder. createBridge API
  preserved (AA1 §2c).

  `mega mcp serve` is the long-running stdio launch entry an agent
  spawns to reach the bridge: it resolves the store + a
  JsonDirectoryCoreRegistry (as `mega output exec` does), starts the
  bridge over stdio, and shuts down cleanly on stdin-EOF / SIGINT /
  SIGTERM. To make the installed config runnable, `installMcp` now
  writes `{ command, args }` (idempotency compares both) and
  `mega mcp install`/`repair` default to `command: "mega"`,
  `args: ["mcp", "serve"]` instead of the unlaunchable `"mega-mcp"`
  literal (gap found by the AA1 §16 live smoke).

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [61efb28]
- Updated dependencies [a8b6531]
- Updated dependencies [ae41534]
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
  - @megasaver/policy@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/output-filter@1.0.0
  - @megasaver/core@1.0.0
