---
"@megasaver/context-gate": minor
"@megasaver/core": minor
"@megasaver/cli": minor
---

runOutputPipeline now records a TokenSaverEvent per file read
(RunOutputResult widens with store_write_failed), core re-exports the
stats read/append surface, and `mega session saver stats` reads the
real stats store (text totals + eventStats in --json; BB6 stub retired).
