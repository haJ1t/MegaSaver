---
"@megasaver/cli": minor
"@megasaver/context-gate": minor
---

Realize Saver Mode on native tool output: a `mega hooks saver` PostToolUse hook
compresses large Read/Bash/Grep/Glob/LS output (evidence-preserving — the full
redacted output is stored as a recoverable chunk), feeds the model the
compressed result via `updatedToolOutput`, and records per-session overlay
events that populate the live GUI Token saver tab. Gated on the Saver Mode
toggle + mode budget; never blocks (exit 0; any error or multi-modal output ⇒
original untouched). `mega hooks install` now installs both the PreToolUse
telemetry hook and the PostToolUse saver hook. Adds context-gate
`recordAndFilterOverlayOutput`.
