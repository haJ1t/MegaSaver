---
title: "@megasaver/indexer"
tags: [entity, package, indexing, phase-2]
sources:
  - concepts/semantic-repo-index.md
  - docs/superpowers/specs/2026-06-11-phase2-semantic-repo-index-design.md
status: active
created: 2026-06-11
updated: 2026-06-11
---

# @megasaver/indexer

Phase 2 package. Parses a repo into typed `CodeBlock`s and persists an
incremental index. Leaf package — depends only on `@megasaver/shared`,
`@megasaver/retrieval`, `@megasaver/policy`, `typescript`, `ignore`,
`zod`; never imports `@megasaver/core`.

## Public surface

- `codeBlockSchema` / `CodeBlock` / `blockTypeSchema` — 8 block types
  (function/class/component/route/test/config/schema/docs); `endLine >=
  startLine`; `.strict()`. `ExtractedBlock` = block minus id/projectId.
- `extractTs(filePath, source)` — TS/JS/TSX via the TypeScript compiler
  API: functions, classes, interfaces/type-aliases (`schema`),
  arrow/function consts. File imports, per-block calls, exports,
  sha256 contentHash, name keywords. PascalCase in tsx/jsx → `component`;
  `*.test`/`*.spec` files → all blocks `test`.
- `extractMd` — ATX-heading sections → `docs` blocks (+ pre-heading
  `(intro)` block when present).
- `extractJson` — top-level keys → `config` blocks; `package.json`
  scripts → `script:<name>`. `lineOf` anchors to the key position.
- `scanRepo({rootDir, maxFileSize?})` — read-only, traversal-safe walk;
  never follows symlinks; honors always-ignore + .gitignore +
  .megaignore (via `ignore`); skips secret/binary/oversized with reasons.
- `buildIndex({rootDir, storeDir, projectId, newId?, maxFileSize?})` —
  incremental by per-file contentHash; reports added/updated/removed/
  unchanged + blockCount. Self-heals a corrupt/torn prior index by
  re-extracting.
- `resolveIndexPaths` / `readBlocks` / `readManifest` / `writeIndex` —
  JSON-directory store: `<store>/projects/<projectId>/index/{blocks.jsonl,
  manifest.json}`, atomic temp+fsync+rename; blocks written first,
  manifest (commit pointer) last.
- `searchBlocks(blocks, {text, type?, limit?})` — BM25 over
  name+keywords+filePath (reuses `@megasaver/retrieval`). Lives here so
  the CLI keeps no retrieval edge (§3c). See [[decisions/policy-is-bb3]]
  for the leaf-isolation pattern, [[entities/retrieval]].

## CLI

`mega scan` and `mega index build/status/search/show` compose the
indexer over the core registry (project name → rootPath + id).
`typescript` is a CLI runtime dependency (externalized from the bundle —
it references `__filename` at load and cannot be inlined into ESM).

## Reconciliation

Status: **shipped** (PR pending). Concept: [[concepts/semantic-repo-index]].
Unblocks Phase 3 ([[concepts/context-pruning-engine]]) — the context
pruner scores these blocks — and the Phase 4 `get_relevant_code_blocks`
MCP tool.
