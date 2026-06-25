---
title: Semantic Repo Index
tags: [concept, indexing, codeblock, phase-2]
sources:
  - sources/roadmap-phases-v2.md
  - syntheses/contextops-roadmap.md
  - entities/retrieval.md
  - docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md
status: active
created: 2026-06-11
updated: 2026-06-26
---

# Semantic Repo Index

Roadmap Phase 2. Instead of handing an agent whole files, hand it
**meaningful code blocks**. Parse the repo into typed, addressable
`CodeBlock`s and let context retrieval operate on blocks, not files
(source: [[sources/roadmap-phases-v2]]).

## Core idea

A file is the wrong unit. A function, a route handler, a test, a
config stanza, a README section — those are the units an agent
actually reasons about. Indexing at block granularity is what makes
[[concepts/context-pruning-engine]] able to return "6–8 relevant
blocks" instead of "40 files."

## CodeBlock shape (roadmap target)

- location: `filePath`, `startLine`, `endLine`, `contentHash`
- type: function | class | component | route | test | config | schema
  | docs
- semantics: `name`, `summary`, `imports[]`, `exports[]`, `calls[]`,
  `calledBy[]`, `keywords[]`, `lastModifiedAt`

First parsers: TypeScript/JavaScript, then Markdown, JSON/package.json,
later Python, Go.

## Reconciliation with shipped code

Status: **shipped** (Phase 2, PR pending) — the `@megasaver/indexer`
package implements `CodeBlock` + AST/structural extractors +
ignore-aware `scanRepo` + incremental `buildIndex` + BM25 `searchBlocks`,
exposed as `mega scan` and `mega index build/status/search/show`. See
[[entities/indexer]]. Built on `@megasaver/retrieval` (BM25) for ranking;
`@megasaver/content-store` (ChunkSet) stays the separate output-pipeline
store. Spec:
`docs/superpowers/specs/2026-06-11-phase2-semantic-repo-index-design.md`.

## Reuse on the read path

The same extractors (`extractTs` / `extractMd` / `extractJson`) that build
this offline index now also drive on-read [[semantic-ast-read]] (PR #182):
[[output-filter]] produces AST-aligned chunks for large source files by
calling them via a lazy cached dynamic `import("@megasaver/indexer")` — keeping
the multi-MB `typescript` compiler off the hot import path
(code: packages/output-filter/src/parsers/semantic.ts). One extraction surface,
two consumers: offline `mega index` and per-read filtering
(spec: docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md).

## Why it matters

The index is the substrate for task-aware pruning (Phase 3) and the
`get_relevant_code_blocks` MCP tool (Phase 4). `contentHash` makes the
index incrementally rebuildable — only changed blocks re-parse.

## Related

- [[syntheses/contextops-roadmap]]
- [[entities/indexer]]
- [[concepts/context-pruning-engine]]
- [[entities/retrieval]], [[entities/content-store]]
