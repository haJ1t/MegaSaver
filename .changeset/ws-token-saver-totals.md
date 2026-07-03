---
"@megasaver/stats": minor
"@megasaver/gui": minor
---

Workspace token-saver totals: aggregate per-session token-saver stats into a
workspace-wide total so the GUI can report savings across every session in a
repository, not just the active one.

- `@megasaver/stats`: totals aggregation over the session set — sums input,
  output, and saved tokens across sessions and derives the workspace savings
  rate from the aggregate rather than averaging per-session rates.
- `@megasaver/gui`: the token-saver panel reports the workspace-wide totals
  alongside the active session's figures.
