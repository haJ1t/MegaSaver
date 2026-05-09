---
"@megasaver/cli": minor
---

Add `mega connector status <projectName> [--target <id>]` — read-only
report of per-target sync state. Status words: `in-sync`, `drift`,
`no-block`, `missing`, `error`. Exit `0` when every line is `in-sync`
or `missing`; `1` if any line is `drift`, `no-block`, or `error`.
