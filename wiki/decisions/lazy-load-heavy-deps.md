---
title: Heavy deps must not statically load into hot-path packages
tags: [decision, performance, output-filter, indexer, hot-path]
sources:
  - docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md
  - packages/output-filter/src/parsers/semantic.ts
status: active
created: 2026-06-26
updated: 2026-06-26
---

# Lazy-load heavy deps on the hot path

**Decision.** A heavy dependency (the multi-MB `typescript` compiler, pulled in
by [[entities/indexer|@megasaver/indexer]]) MUST NOT be statically imported into
a core hot-path package. Load it via a cached lazy dynamic import at the point of
use instead (PR #182).

## Why

[[output-filter|@megasaver/output-filter]] is transitively imported by every
`mega hooks saver` per-tool-call process (core → context-gate → output-filter),
so anything in its eager import graph runs on every tool call. A static
`import` of the indexer in `semantic.ts` eager-loaded the `typescript` compiler
on *every* output-filter import — it caused a CI timeout (the connector
public-export path) and slowed the hook hot path (PR #182).

## Mechanism

The fix made the import dynamic and memoized: a module-level `indexerMod` cache
filled by `loadExtractors()` via `await import("@megasaver/indexer")`, called
only inside `chunkBySemantic` (code: packages/output-filter/src/parsers/semantic.ts).
Consequence: `chunkBySemantic` / `chunkByFormatWithMeta` / `filterOutput` /
`filterRaw` are now async. The compiler loads only when an actual source file is
semantically chunked, never on plain import. See [[semantic-ast-read]].

## Guard

Keep the regression test `no-eager-typescript.test.ts`: it imports the built
`output-filter` entry in a clean child process and asserts zero `typescript`
modules in `process.moduleLoadList`
(code: packages/output-filter/test/no-eager-typescript.test.ts). A child process
is used so the count reflects a clean graph, not vitest's own.
