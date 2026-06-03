---
"@megasaver/connectors-shared": minor
"@megasaver/mcp-bridge": minor
"@megasaver/gui": minor
"@megasaver/cli": patch
---

Ship the final AA1 epic surface (BB11): GUI AgentSetupDoctor + connector
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
