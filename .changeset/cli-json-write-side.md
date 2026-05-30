---
"@megasaver/cli": minor
---

Add `--json` to the write-side commands: `mega session create`,
`session end`, `session update`, `memory create`, and
`connector sync` — completing read + write-side `--json` coverage
across the relevant commands. Default (non-`--json`) output stays
byte-identical to the existing text format. Errors remain
plain-text on stderr with exit 1 (no JSON emit on usage / typed
errors).
