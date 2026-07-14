---
"@megasaver/core": minor
"@megasaver/stats": minor
"@megasaver/connectors-shared": minor
"@megasaver/connector-claude-code": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Warm Start: budgeted session boot brief for every agent. A pure assembler
(`assembleWarmStartBrief`) renders standing rules, decisions, open todos,
branch-touching failed attempts, git delta, and hot-spot entities into a
hard-budgeted markdown brief (default 2000 tokens; micro <4h = 300; reonboard
>14d shows what changed while you were away). Delivered via a fail-open
Claude Code SessionStart hook (`mega hooks warmup`, installed by
`mega hooks install`, opt-out `--no-warmup`), `mega warmup` on stdout, a
Pro-gated cross-agent sentinel block (`mega warmup --write`, refreshed by
`mega connector sync`), and an MCP `get_warm_start_brief` tool. Reporting is
measured-only: a separate `WarmStartEvent` (never a TokenSaverEvent) feeds a
"Warm start: N sessions warmed" line in savings history/insights.
