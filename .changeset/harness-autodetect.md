---
"@megasaver/shared": minor
"@megasaver/connector-generic-cli": minor
"@megasaver/harness-detect": minor
"@megasaver/cli": minor
---

Harness auto-detect + first-run auto-configure: new `@megasaver/harness-detect` package with a 39-harness detection catalog (PATH binaries, home config dirs, VS Code extension dirs, project markers), `agentIdSchema` grows 8 → 40, 9 new flat-file connector targets (cline, roo-code, kilo-code, copilot, opencode, amazon-q, qwen, trae, antigravity), new `mega detect` command, and a `mega init` harness-scan step that auto-configures connector blocks for every detected harness (AGENTS.md family folds onto the codex target).
