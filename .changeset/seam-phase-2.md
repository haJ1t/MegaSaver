---
"@megasaver/context-gate": minor
"@megasaver/output-filter": minor
"@megasaver/cli": minor
---

Live Context Seam phase 2: harden failure capture, feed failures back through
every read path, and make the seam observable and switchable end to end.

- `@megasaver/context-gate`: overlay failure store persists captured failures
  through the registry; failure-aware ranking now applies on registry read
  paths, with new memory and conventions hint sources feeding the gate.
  Capture filtering skips evidence-free exit-1 runs, and failure signatures
  are restricted to a code-extension allowlist so non-code noise never
  becomes a signature. Seam replay traces are recorded with an A/B switch.
- `@megasaver/output-filter`: new kill switch resolver disables the seam per
  scope, and `readReplayTraces` exposes recorded replay traces to consumers.
- `@megasaver/cli`: new `mega audit seam` command reports seam effectiveness
  from recorded replay traces.
