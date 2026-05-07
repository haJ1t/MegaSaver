---
"@megasaver/shared": patch
---

Add `codex` to the `AgentId` enum so the upcoming generic-cli connector
target can carry its own agent identity instead of collapsing into
`generic-cli`.
