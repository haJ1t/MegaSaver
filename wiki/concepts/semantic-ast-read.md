---
title: Semantic AST Read
tags: [concept, output-filter, chunking, ast, risk-high, phase-6]
sources:
  - docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md
  - docs/superpowers/plans/2026-06-26-semantic-ast-read.md
status: active
created: 2026-06-26
updated: 2026-06-26
---

# Semantic AST Read

On-read chunking that carves a large SOURCE file into AST-aligned
chunks (functions, classes, headings, JSON keys) instead of naive
40-line windows, so ranking scores coherent declarations (PR #182).
Risk HIGH (spec: docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md).

## Problem

`chunkByLines(text, 40)` split a function spanning lines 30–55 across
two windows; `scoreChunk → fitBudget` then ranked fragments — keyword
hits in the wrong window, signature and body in different chunks, half
a function kept and half dropped. Intent-driven reads returned mangled,
mid-declaration excerpts (spec: §Problem).

## Mechanism

`chunkBySemantic(text, path)` + `partitionFile` reuse the
[[indexer]] extractors `extractTs` / `extractMd` / `extractJson`
(TS compiler API, already vendored — NO tree-sitter) to get AST blocks,
then build a **whole-file gap-filling partition**: declaration blocks +
line-chunks for the gaps between/around them, so no line is dropped from
ranking. Oversized blocks (> `OVERSIZE_BLOCK_LINES`, 80) are sub-split by
lines. The result is plain `Chunk[]` feeding the existing
`scoreChunk → dedupe → fitBudget` pipeline unchanged
(code: packages/output-filter/src/parsers/semantic.ts).

`chunkByFormatWithMeta` gates on file source + supported extension
(`.ts/.mts/.cts/.tsx/.jsx/.js/.mjs/.cjs/.md/.json`). Everything else —
command/grep/fetch output, unsupported ext, parse error, zero blocks —
falls through to `chunkByLines`. The chunker NEVER throws: it returns
`null` and the caller falls back (spec: §Goal). Chunk ids are still
assigned numerically downstream, so the expand-chunk contract is
untouched.

## Lazy-load perf decision

The multi-MB `typescript` compiler is on the hot path
(`mega hooks saver → core → [[context-gate-pipeline]] → [[output-filter]]`),
so [[indexer]] is loaded via a lazy cached dynamic `import()` inside
`chunkBySemantic` — never eager on plain `import("@megasaver/output-filter")`.
Consequence: `chunkBySemantic / chunkByFormatWithMeta / filterOutput /
filterRaw` are now ASYNC. A guard test (`no-eager-typescript.test.ts`)
asserts zero `typescript` modules load on import. See
[[lazy-load-heavy-deps]] (PR #182).

## Related

- [[output-filter]] — host package (chunk production)
- [[indexer]] — extractor source, also drives [[semantic-repo-index]]
- [[context-gate-pipeline]] — read path that calls `filterRaw`
