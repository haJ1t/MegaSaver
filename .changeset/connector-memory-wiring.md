---
"@megasaver/cli": patch
---

Wire `mega connector sync` and `mega connector status` to read
real memory entries via `registry.listMemoryEntries(project.id)`.
The connector context now includes project-scoped entries plus
session-scoped entries belonging to the target's
currently-picked open session. Other agents' session-scoped
memory is filtered out. Empty-memory projects continue to render
`- none` byte-identically.
