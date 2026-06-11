---
"@megasaver/indexer": minor
"@megasaver/shared": minor
"@megasaver/cli": minor
---

Phase 2 (Semantic Repo Index): new `@megasaver/indexer` package that
parses a repo into typed `CodeBlock`s — AST extraction for TS/JS/TSX via
the TypeScript compiler API, structural extraction for Markdown (heading
sections) and JSON (top-level keys + package.json `script:<name>`), an
ignore-aware traversal-safe `scanRepo` (never follows symlinks; honors
always-ignore + .gitignore + .megaignore; skips secret/binary/oversized
files), an atomic JSON-directory store with `contentHash` incremental
`buildIndex`, and BM25 `searchBlocks`. New `CodeBlockId` in
`@megasaver/shared`. CLI gains `mega scan` and `mega index
build/status/search/show`. `typescript` is a CLI runtime dependency
(externalized from the bundle).
