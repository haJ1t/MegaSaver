---
"@megasaver/cli": patch
"@megasaver/core": patch
"@megasaver/connector-claude-code": patch
---

`mega alerts --failures`: free, session-scoped silent-failure report —
four detectors (tool-error, context-overflow, partial-completion,
hallucinated-state) over existing overlay stores, alerts-style table +
`--json`, per-detector opt-out, `--strict` CI exit. Detectors with no
backing signal report `no-signal`, never a guess. Opt-in warn-only Stop
hook (`mega hooks failure-scan`, off by default) fires when a session
stops with an unresolved failing receipt. Core re-exports the read-index
surface; the connector hook-command union gains `failure-scan`.
