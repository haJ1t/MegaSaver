---
"@megasaver/connectors-shared": minor
"@megasaver/connector-claude-code": minor
---

Agent Office Phase 1: add the agent-agnostic AgentLauncher interface
(+ LauncherError) and a claude-code adapter that runs one headless
`claude -p` task with stream-json output. Spawn is injectable; the
engine/supervisor wiring lands in Phase 2.
