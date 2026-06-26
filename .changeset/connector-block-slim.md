---
"@megasaver/connectors-shared": patch
---

Slim the connector Context Gate block: drop the redundant "enabled for this
session" line and the duplicated "prefer over native" intro (the same guidance
is already stated once below). All load-bearing guidance — the four MCP tool
bullets, the `intent` rule, the prefer-proxy/expand rules — is unchanged. Saves
a few injected tokens per turn with no loss of agent guidance.
