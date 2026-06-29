---
title: Outline-First Read (Progressive Disclosure)
status: approved
risk: medium
created: 2026-06-29
author: claude-code
reviewers: [code-reviewer, critic]
sources:
  - concepts/semantic-ast-read.md
  - entities/indexer.md
  - concepts/diff-on-reread.md
---

# Outline-First Read (Progressive Disclosure)

## Goal

`mega_read_file` gains an opt-in `outline: true` flag. When set on a
supported source file, the read returns the file's **skeleton** —
deduped imports plus every top-level declaration's signature, line
range, and chunk id — instead of the bodies. The agent expands only
the body it needs with the existing `mega_fetch_chunk(chunkSetId, id)`.

A 1000-line file collapses to a ~50-line skeleton on the read; every
body remains one fetch away. The change is **lossless** (no source line
is unreachable), **additive** (zero behavior change when the flag is
absent), and reuses the AST substrate shipped in PR #182.

## Problem

Today an intent-driven read (`chunkBySemantic` → `scoreChunk` →
`fitBudget`) returns the chunks that best match the caller's `intent`
and drops the rest within budget. That is the right tool when the
caller knows *what* they are looking for. It is the wrong tool when the
caller wants a **map** of a large unfamiliar file: ranking by intent
returns a few bodies and hides the file's overall shape, so the agent
re-reads with new intents to discover what exists.

Outline-first read is the complement: return the full structural map
(every top-level signature) cheaply, let the agent pull bodies on
demand. It is not a replacement for intent ranking — it is a second
read mode for the "show me the shape" case.

## Non-goals

- Not auto-activated. Opt-in flag only (see Decisions).
- Not nested-member depth. Top-level declarations only in v1.
- Not summaries. Signatures only; no heuristic or LLM-generated
  per-declaration prose (honors the no-proxy-LLM-by-default rule).
- Not a new tool. Reuses `mega_read_file` + `mega_fetch_chunk`.

## Decisions (from brainstorming)

1. **Activation = opt-in `outline: true`.** Truest reading of
   "additive + fallback, MEDIUM risk": zero change to any existing
   read, no size threshold to tune, no regression surface. Connector
   guidance can nudge the agent to use it for large source reads,
   capturing most of the automatic win without the behavior change.
2. **Depth = top-level only.** A class is one signature; its methods
   live in the expandable body. Smallest skeleton, simplest extractor
   use (nested spans are not all extracted today).
3. **No summary line.** Signature + range carries the meaning;
   staying signatures-only keeps the feature lossless and zero-dep.

## Architecture

```
mega_read_file {outline:true}
  -> runOutputPipeline(outline)          # core: thread flag
    -> filterRaw(outline)                # context-gate
      -> filterOutput(outline)           # output-filter: NEW early branch
           redact -> normalize           # unchanged (security preserved)
           outlineFile(text, path)       # NEW: extractor -> {skeleton, chunks}
             |- null? -> fall through to normal rank/fit read
      -> persistChunkSet(result.chunks)  # persist BODIES, not the skeleton
  -> result.excerpts = skeleton ; result.chunks = bodies ; decision="outline"
mega_fetch_chunk(chunkSetId, id)         # UNCHANGED -> returns the full body
```

The display (skeleton) and the persisted ChunkSet (bodies) diverge in
outline mode. This mirrors the PR #181 `unchanged-marker` precedent: a
distinct `decision` value plus a result payload that the persistence
and render sides interpret specially.

## Components

### 1. `outlineFile(text, path)` — `output-filter/src/parsers/outline.ts` (new)

Loads the indexer extractor via the same lazy cached dynamic import as
`chunkBySemantic` (keeps the multi-MB `typescript` compiler off the
eager import path — see [[lazy-load-heavy-deps]]). Async for the same
reason.

Returns `null` (never throws) to signal "fall back to a normal read":
unsupported extension, parse failure, or zero extracted blocks. All
three collapse to one fallback path, identical to `chunkBySemantic`.

On success returns `{ skeleton: string; chunks: Chunk[] }`:

- **chunks** = `partitionFile(text, blocks, Infinity)` — the existing
  whole-file gap-filling partition with oversize sub-splitting
  disabled, so each top-level declaration is one whole chunk and the
  gaps between/around declarations are still chunks. Full coverage:
  every source line lands in exactly one chunk, so nothing is
  unreachable via `mega_fetch_chunk`.
- **skeleton** = rendered text:
  ```
  <path> — outline: <N> declarations, <M> lines.
  Expand a body: mega_fetch_chunk(<chunkSetId>, <id>).
  imports: <deduped import specifiers>

  #<id>  L<start>-<end>  <signature>
  ...
  ```
  `<id>` is the chunk index of that declaration's body in `chunks`.
  The builder produces chunks and skeleton in one pass so the
  declaration→chunk-index mapping is exact.

- **signature** = literal source lines from the declaration's
  `startLine` up to and including the first line containing the body
  opener (`{` for C-family extensions, `:` for `.py`), capped at
  `SIGNATURE_MAX_LINES` (6), with a trailing lone opener stripped. The
  text is verbatim source — never synthesized. A signature longer than
  the cap is truncated in the skeleton only; the full body is one fetch
  away, so the file-level read stays lossless. Marked with a
  `ponytail:` comment naming the cap and the upgrade path (extend to
  the true body-opener) since this is the one heuristic in the feature.

### 2. `filterOutput` outline branch — `output-filter/src/types.ts`

New optional input field `outline?: boolean` on the filter input
schema. When `outline === true`, the source is a file, and
`outlineFile(normalized, path)` returns non-null, short-circuit before
the compress/rank/fit decision:

- `excerpts` = a single excerpt whose `text` is the full rendered
  skeleton (its `startLine`/`endLine` span the whole file).
- `chunks` = the bodies from `outlineFile`; each body's index is the
  `#id` referenced in the skeleton text.
- `decision = "outline"`, byte/token stats computed skeleton-vs-raw.

`outlineFile` runs on the already-redacted, already-normalized text so
persisted bodies carry the same redaction as a normal read. If the
gate conditions are not met (flag false, non-file source, or
`outlineFile` null), the function proceeds exactly as today.

### 3. `FilterOutputResult.chunks?` — `output-filter` types

New optional `chunks` field on the result (the bodies, each with
`startLine`/`endLine`/`text`). `persistChunkSet` persists
`result.chunks ?? result.excerpts` — present only in outline mode, so
every existing path persists `excerpts` byte-for-byte as before.

### 4. Plumbing

Add optional `outline?: boolean`, default `false`, threaded:
`mega_read_file` tool schema → `runOutputPipeline` input → `filterRaw`
→ `filterOutput`. Absent flag → unchanged behavior at every hop.

### 5. diff-on-reread interaction

The PR #181 read-index suppresses an unchanged re-read with an
`unchanged-marker` keyed on content hash. Add the `outline` flag to the
read-index key so an outline read after a full read of the same
unchanged file is not suppressed as the wrong view (and vice versa).
One-line key change; both views of an unchanged file remain
independently expandable.

## Contracts preserved

- `mega_fetch_chunk` is untouched — outline bodies are ordinary stored
  chunks addressed by `(chunkSetId, id)`.
- Redaction runs before the outline branch; bodies are persisted
  redacted.
- Two-gate read safety (policy denylist + sandbox resolver) is
  unchanged and still runs before any `fs.readFile`.
- Non-source files, unsupported extensions, parse failures, and
  zero-block files fall back to today's read with identical output.
- The no-eager-`typescript` guard test stays green (lazy import path
  reused).

## Error handling

- `outlineFile` returns `null` rather than throwing on any extraction
  failure; the caller falls back to a normal read.
- `outline: true` on a non-source file is not an error — it falls back
  to a normal read (the flag is advisory).
- All existing read error paths (`path_denied`, `path_unsafe`,
  `file_read_failed`, `policy_load_failed`, `store_write_failed`) are
  unchanged.

## Testing (TDD — red before green)

Unit — `outlineFile`:
- signature render: single-line and multi-line (wrapped params) cases.
- id ↔ body mapping: skeleton `#id` resolves to the matching body
  chunk.
- full coverage: every source line appears in exactly one chunk
  (partition invariant).
- returns `null` on unsupported extension, empty file, parse failure,
  zero blocks.

Unit — `filterOutput` outline branch:
- outline-eligible read → `decision: "outline"`, skeleton in
  `excerpts`, bodies in `chunks`.
- flag false OR non-file source OR `outlineFile` null → identical to
  current behavior (no `chunks`, normal `decision`).

Integration:
- `mega_read_file {outline:true}` on a multi-declaration TS file →
  skeleton returned; `mega_fetch_chunk(chunkSetId, id)` → the correct
  full body for each id.
- `mega_read_file` without the flag → byte-identical to current output.
- outline read then unchanged full re-read → not cross-suppressed.

Guard:
- existing `no-eager-typescript.test.ts` stays green.

## Risk

MEDIUM. Additive, fallback-guarded, lossless. Touches the
`output-filter` chunk-production path, which is HIGH-adjacent
(evidence-preserving compression), so the reviewer set is
`code-reviewer` AND `critic` (separate passes), per risk-modes §HIGH
caution applied to a MEDIUM change.

## Out of scope / future

- Auto-activation over a size threshold (add when opt-in adoption
  proves the demand).
- Nested-member depth (method signatures inside classes).
- Heuristic or LLM-generated summary lines.
- Signature rendering beyond the line cap.
