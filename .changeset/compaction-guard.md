---
"@megasaver/content-store": patch
"@megasaver/connector-claude-code": patch
"@megasaver/cli": patch
---

`compaction-guard`: reconnect post-compact agents to intra-session overlay
receipts without repeating prior tool runs. Snapshot on PreCompact
(`mega hooks capsule`), bounded recap context injection on SessionStart
(`mega hooks recap`, ≤2,000 tokens), and reconnected `chunkSets` and `capsule`
legs in `loadFailureSnapshot`. Installed by default with `--no-compaction-guard`
opt-out.
