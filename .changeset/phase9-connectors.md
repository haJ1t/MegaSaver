---
"@megasaver/shared": minor
"@megasaver/connector-generic-cli": minor
"@megasaver/cli": minor
---

Phase 9 — Multi-Agent Connectors. `agentIdSchema` widens to eight
members (adds `continue`, `gemini`, `windsurf`).
`@megasaver/connector-generic-cli` ships three new flat-file targets:
`geminiTarget` (`GEMINI.md`), `windsurfTarget` (`.windsurfrules`),
`continueTarget` (`.continue/rules/megasaver.md`) — each a frozen
target object reusing the existing sync path (no new sync code). The
CLI registers them in `KNOWN_TARGETS` and adds two commands:
`mega connector list` (known targets + present/absent, exit 0) and
`mega connector doctor` (per-target exists/writable/in-sync vs stale,
exit 1 on any stale/not-writable/error). Cross-agent shared memory is
proven by an integration test (project memory synced to two agents
lands byte-identically in both files). `vscode`/`jetbrains` (native IDE
plugins) and a `mega connect` alias are out of scope. The four shipped
targets (`claude-code`/`codex`/`cursor`/`aider`) are byte-identical.
