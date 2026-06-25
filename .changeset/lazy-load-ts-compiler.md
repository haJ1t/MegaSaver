---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
---

Lazy-load the TypeScript compiler out of the eager import graph. The
semantic AST chunker imported `@megasaver/indexer` (which statically
imports the multi-MB `typescript` compiler) at the top of
`output-filter`, so importing `@megasaver/output-filter` — and thus
every per-tool-call hook, the daemon, and the CLI — eagerly paid a
multi-second compiler load on startup. The indexer is now imported
dynamically inside `chunkBySemantic`, gated behind a supported-extension
precheck, so `typescript` only loads when a source file is actually
chunked.

This makes `filterOutput` and `chunkByFormat`/`chunkByFormatWithMeta`
(`@megasaver/output-filter`) and `filterRaw` (`@megasaver/context-gate`)
async — they now return promises. All in-tree callers await them; the
semantic chunker still never throws (parse error or unsupported source
falls back to line chunking).
