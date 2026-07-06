---
"@megasaver/cli": minor
---

Add `mega init` — one-command onboarding that installs the Claude Code hooks
and MCP bridge, enables the workspace saver (default mode `balanced`), and opens
the GUI. Auto-runs with a per-step summary; `--yes` skips the confirmation
prompt, `--no-gui` keeps it headless, and `--mode`/`--store` override the
defaults. A failed step never aborts the rest and the exit code reflects any
failure.
