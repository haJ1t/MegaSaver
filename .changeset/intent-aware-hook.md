---
"@megasaver/cli": minor
"@megasaver/context-gate": minor
"@megasaver/daemon": minor
"@megasaver/connector-claude-code": minor
---

Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
and fills it as the ranking intent for PostToolUse-captured native output when no
explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.
