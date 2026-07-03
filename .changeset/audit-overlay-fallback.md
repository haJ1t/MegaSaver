---
"@megasaver/cli": minor
"@megasaver/stats": minor
---

Audit overlay fallback: when a session has no recorded audit overlay, fall back
to the last known good overlay instead of rendering an empty panel, so the audit
view stays useful across sessions that predate overlay capture.

- `@megasaver/stats`: overlay resolution degrades gracefully — a missing
  per-session overlay resolves to the most recent available overlay rather than
  returning nothing.
- `@megasaver/cli`: the audit command surfaces the fallback overlay and flags it
  as inherited so the operator knows the data is not session-specific.
