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

Every source line is persisted in some fetchable chunk. `partitionFile` is an
exhaustive gap-filling partition (declaration blocks + line-chunks for the gaps
between/around them), so an agent that fetches every chunk recovers 100% of the
file content.

## Limitations

- Co-located declarations (multiple top-level decls on one line — minified
  JSON/JS, one-liner exports) share a single chunk; the skeleton emits one
  entry per distinct chunk id (whose signature line already shows them all),
  so `#id`s stay unique and the count is honest.
- Size floor (implemented): outline only takes the branch when the skeleton is
  meaningfully smaller than raw — `skeletonBytes < 0.9 × rawBytes`
  (`OUTLINE_MAX_SKELETON_RATIO` in `output-filter/src/types.ts`). On tiny or
  dense/minified files the signature skeleton can equal or exceed raw bytes
  (measured: a small `alpha`/`beta` `.ts` → skeleton 204 B vs raw 148 B); there
  the read falls through to the normal rank/fit pipeline rather than return a
  payload larger than a plain read. Lossless either way (the normal read
  persists its own chunks). The 0.9 ratio (vs. merely "not bigger") avoids a
  near-raw skeleton that costs a second fetch round-trip for ~no saving.

## Related

- [[semantic-ast-read]] — same [[indexer]] extractors; outline mode reuses
  `extractorFor` + `partitionFile`, adds skeleton rendering
- [[indexer]] — extractor source (`extractTs` / `extractMd` / etc.)
- [[diff-on-reread]] — unchanged-marker; outline reads use a separate index slot
