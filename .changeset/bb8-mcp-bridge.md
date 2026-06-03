---
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
widened to 16 members, McpToolName closed enum, the
`mega mcp install/repair/status/uninstall` CLI, and the
`McpSetupOps` facade (with `aggregateMcpStatus` reporting
`mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
per agent) wired into the GUI bridge as the production `mcpOps`.
Replaces the v0.3 not_implemented placeholder. createBridge API
preserved (AA1 §2c).
