---
"@megasaver/core": minor
---

Add `initStore(rootDir)` — idempotent helper that creates the JSON
directory store layout (`projects.json`, `sessions.json`) without
overwriting existing files. Used by `@megasaver/cli` for first-run
auto-init.
