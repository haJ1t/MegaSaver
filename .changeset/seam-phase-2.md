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
  Hint building is best-effort per source — a corrupt store file degrades to
  a non-fatal `session hints skipped` warning instead of failing the read.
  Capture filtering skips evidence-free exit-1 runs, redacts the full raw
  output before the 4000-char evidence cap, and failure signatures are
  restricted to a code-extension allowlist so non-code noise never becomes a
  signature. Seam replay traces are recorded with an A/B switch, gated behind
  opt-in `MEGASAVER_SEAM_TRACE=true`.
- `@megasaver/output-filter`: new kill switch resolver disables the seam per
  scope, `seamTraceEnabledByEnv` gates trace recording, and
  `readReplayTraces` exposes recorded replay traces to consumers.
- `@megasaver/cli`: new `mega audit seam` command reports seam effectiveness
  from recorded replay traces.
