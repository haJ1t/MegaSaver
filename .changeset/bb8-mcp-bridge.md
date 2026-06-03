---
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
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
