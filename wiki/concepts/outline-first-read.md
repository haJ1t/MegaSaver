---
title: Outline-First Read
tags: [concept, output-filter, context-gate, mcp-bridge, ast, risk-high, phase-7]
sources:
  - docs/superpowers/specs/2026-06-29-outline-first-read-design.md
  - docs/superpowers/plans/2026-06-29-outline-first-read-plan.md
status: active
created: 2026-06-29
updated: 2026-06-29
---

# Outline-First Read

Opt-in skeleton read: `mega_read_file { outline: true }` returns the file
structure (imports + top-level signatures + line ranges + chunk ids) instead
of ranked excerpts, and persists every declaration body so the agent expands
only what it needs via `mega_fetch_chunk`.

## Skeleton / expand contract

`filterOutput({ outline: true })` calls `outlineFile(text, path)` which:

1. Invokes the [[indexer]] extractor for the file extension (same extractors
   as [[semantic-ast-read]] — no new parsing).
2. Calls `partitionFile(text, blocks, Infinity)` (oversize limit disabled —
   each declaration is its own chunk, no sub-splitting).
3. Renders skeleton lines: `#<id>  L<start>-<end>  <signature>`.
4. Returns `{ skeleton, chunks[] }`.

`persistChunkSet` stores `result.chunks` (the bodies) instead of
`result.excerpts` (the skeleton placeholder) in outline mode, so
`mega_fetch_chunk(chunkSetId, id)` returns the full declaration body.

Result shape: `FilterOutputResult` with `decision: "outline"`,
`excerpts: [skeletonExcerpt]`, `chunkSetId` (after persist), `chunks` (bodies
for the persist sink).

## Scope and fallback

Registry-path reads only (v1). Overlay/live-session reads always use a normal
read (overlay `persistChunkSet` ignores `result.chunks`). Falls back silently
to a normal read for: unsupported extension, parse error, zero blocks, empty
file.

## Read-index key

Outline reads key on `path + "\0outline"` in the per-session read-index so
a prior full-read's `unchanged-marker` cannot suppress an outline request
(and vice versa). `\0` is illegal in filesystem paths on every OS, preventing
collisions with real path hashes.

## Lossless property

Every declaration body is persisted as a fetchable chunk. No line is dropped:
`partitionFile` with `Infinity` limit produces one chunk per AST block, and
the skeleton lists all of them. An agent that fetches every chunk recovers
100% of the file content.

## Related

- [[semantic-ast-read]] — same [[indexer]] extractors; outline mode reuses
  `extractorFor` + `partitionFile`, adds skeleton rendering
- [[indexer]] — extractor source (`extractTs` / `extractMd` / etc.)
- [[diff-on-reread]] — unchanged-marker; outline reads use a separate index slot
