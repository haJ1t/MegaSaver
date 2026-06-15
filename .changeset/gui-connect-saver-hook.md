---
"@megasaver/connector-claude-code": minor
"@megasaver/cli": patch
"@megasaver/gui": patch
---

Add an in-app "Connect Saver hook" toggle. The Token saver panel can now
install/uninstall the global Claude Code Mega Saver hooks
(`~/.claude/settings.json`) in the background, replacing the terminal-only
`mega hooks install claude-code`. Hook-settings logic moved into
`@megasaver/connector-claude-code` (new `uninstall`/`status` functions),
exposed via a global bridge route `/api/hooks/claude-code` (GET/POST/DELETE)
and a symmetric CLI `mega hooks uninstall claude-code`.
