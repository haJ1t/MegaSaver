---
"@megasaver/connector-claude-code": minor
"@megasaver/cli": patch
---

Restore Claude Code first-party prompt caching behind the proxy. The route
installer now writes `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` next to
`ANTHROPIC_BASE_URL` (default upstream only) and removes it with the route,
eliminating the custom-base-URL cache penalties: inline tool schemas
(+90k tokens/request), uncached hook-output tail (~20k/session), and
cold-cache double writes (up to 176k tokens).
