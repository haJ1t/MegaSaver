---
"@megasaver/cli": patch
---

Fix the standalone `mega.mjs` bundle crashing at startup with
`__filename is not defined in ES module scope`. The bundle inlines the
TypeScript compiler (pulled in via `@megasaver/indexer`), which reads
`__filename`/`__dirname` at module load — undefined in ESM. The
`tsup.bundle` banner now shims `__filename` and `__dirname` (alongside
the existing `require` shim) so every command, including `mega index`
and `mega mcp serve`, runs from the single self-contained file with no
`node_modules`. A CI bundle smoke (`node mega.mjs doctor`) and a
local guarded test prevent the regression from returning.
