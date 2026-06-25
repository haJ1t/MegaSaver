# Plan — Semantic AST Read (chunker)

- **Spec:** `docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md`
- **Branch:** `feat/semantic-ast-read` (commit here; never switch branches)
- **Risk:** HIGH (§12 — compression core chunker). De-risked: additive,
  source/extension gated, line-chunk fallback for everything else,
  parse-error fallback, exhaustive partition invariant.
- **Scope:** chunk-PRODUCTION step only. No persisted index, no AST cache,
  no cross-file analysis, no `scoreChunk`/keyword changes, no expand-chunk
  storage change.

## Ground-truth seams (verified on branch, post-PR-181)

- `chunkByFormat(text)` lives in `packages/output-filter/src/parsers/index.ts`
  (L13-22): format-detector chain, fallback `chunkByLines(text, 40)`. Returns
  `Chunk[]`.
- Callsite `packages/output-filter/src/types.ts` L173:
  `const chunks = chunkByFormat(textForChunks);`. Sequence: `scoreChunk` map
  (L174) → `applyEngineRanking` (L178, flag) → `dedupe` (L179,
  UNCONDITIONAL) → `effectiveBudget` (L182) → `fitBudget` (L183).
- `source` is `parsed.data.source`, destructured at L135. Discriminated union
  `file{path} | command{command,args} | grep{query} | fetch{url}`, optional.
- `Chunk = { text, startLine, endLine }` (1-indexed inclusive) in `rank.ts`
  L35-39. NO id at production time. Ids assigned numerically downstream when
  persisted — multi-chunk semantic result needs ZERO id handling here.
- `chunkByLines(text, linesPerChunk)` in `src/chunk.ts` L3-16: empty string →
  `[]`; else 1-indexed inclusive windows.
- `fitBudget` (`src/fit.ts`) sorts by score desc, SKIPS any chunk whose bytes
  exceed remaining budget → oversized single chunk dropped (decision 6).
- `extractTs(filePath, source) → ExtractedBlock[]`, siblings `extractMd`,
  `extractJson`, all exported from `packages/indexer/src/index.ts`. Each block
  has `{ filePath, startLine, endLine, blockType, name?, ... }`. typescript@5.7.3
  is an indexer dep. `extractTs` does NOT catch parse errors internally — TS
  compiler is lenient (returns partial blocks, rarely throws), but the chunker
  MUST still `try/catch` per decision 4. `extractJson`/`extractMd` return `[]`
  on malformed/heading-less input (graceful skip).
- DEP GRAPH: output-filter does NOT yet depend on indexer; adding it is
  cycle-safe. content-store depends on output-filter.
- TS config: `output-filter/tsconfig.json` has `composite: false`, NO
  `references` array — repo does NOT use TS project references. **No tsconfig
  change needed.**
- TS strict: `exactOptionalPropertyTypes` (conditional spread for optional
  props), `noPropertyAccessFromIndexSignature`, ESM (`.js` import specifiers),
  NodeNext.

## Two CRITICAL gap fixes baked into the design (NOT optional)

1. **Compressor skip for file sources (spec §2a).** The callsite runs
   classify → compress BEFORE chunking and feeds the *compressed* text into
   `chunkByFormat`. For a file read the classifier is content-only (`command`
   is `undefined`), so any `.ts` body merely *containing* `error TS1234:`
   classifies as `typescript` conf 0.7 and gets rewritten into a synthetic
   "Top files by error count" summary — every line span the extractor returns
   would then be wrong. **Guard the compress block on `!isFileSource`** so the
   ORIGINAL `normalized` reaches the chunker for every file read. `compressor`
   stays `"generic"` for file reads (accurate).
2. **Dedupe skip for the semantic path (spec §6, memory 5050).** `dedupe`
   runs UNCONDITIONALLY at L179 with `HAMMING_DEDUPE_THRESHOLD = 3` bits.
   Semantic blocks are small and structurally near-identical (one-line JSON
   keys, repeated `export const` shapes), routinely collide within 3 bits, and
   dedupe would delete whole distinct declarations — breaking the partition
   invariant. **Skip dedupe when the semantic branch ran.** To know that
   without re-deriving it, `chunkByFormat` exposes the bit via a sibling
   `chunkByFormatWithMeta(text, source) → { chunks, semantic }`. The one
   boolean decides BOTH "use semantic chunks" and "skip dedupe".

## Oversize threshold decision (resolved)

`chunkBySemantic(text, path)` has no mode/budget in scope (its caller
`chunkByFormat` gets none). Per spec decision 6 ("use the mode budget, OR a
sane line cap"), use a **line cap** constant `OVERSIZE_BLOCK_LINES = 80`
(2× the 40-line default window) inside the chunker. Self-contained, budget-
agnostic, smallest diff. `// ponytail: line cap, not budget — chunker has no
budget in scope; bump if oversized blocks still drop.`

## Partition algorithm (`partitionFile`)

Inputs: full `text`, block line-spans (sorted, may overlap-free from
extractor), `oversizeLines`. Output: `Chunk[]` covering `[1, lastLine]`
exactly once, ordered by `startLine`.

1. `lines = text.split("\n")`; `lastLine = lines.length`. Empty text → `[]`.
2. Sort block spans by `startLine`. Clamp each span to `[1, lastLine]`.
3. Walk `cursor = 1`. For each block span `[bs, be]`:
   - If `bs > cursor`: emit a **gap** chunk for lines `[cursor, bs-1]` via
     `lineChunksFor(cursor, bs-1)`.
   - Emit the block: if `(be - bs + 1) > oversizeLines`, sub-split via
     `chunkByLines(blockText, oversizeLines)` with start offset remapped to
     `bs`; else one chunk for `[bs, be]`.
   - `cursor = be + 1`.
4. After the loop: if `cursor <= lastLine`, emit a trailing gap chunk for
   `[cursor, lastLine]`.
5. Blocks from `extractTs` are top-level declarations and never overlap, but
   defensively skip any span whose `bs < cursor` (already covered) so a
   pathological extractor never double-counts a line.

`lineChunksFor(start, end)` = `chunkByLines(lines.slice(start-1, end).join("\n"),
oversizeLines)` with each resulting chunk's `startLine`/`endLine` shifted by
`(start - 1)`.

## Tasks (sequential; failing test → minimal impl → commit)

T1 dep → T2 → T3 → T4 → T5. Each commits to `feat/semantic-ast-read` with
explicit paths only (NEVER `git add -A`; ~14 pre-existing untracked cruft
files must stay untracked). Run `pnpm exec biome check <changed files>`
before each commit.

### T1 — Add @megasaver/indexer dependency to output-filter

Wiring proof: a test imports `extractTs` through the output-filter package
boundary. No tsconfig change (no project refs).

### T2 — Semantic chunker module `src/parsers/semantic.ts`

`chunkBySemantic(text, path): Chunk[] | null` + exported `partitionFile`.
Extension dispatch, try/catch → null, zero blocks → null, gap-fill, oversize
sub-split, sort by startLine. `null` = "fall back to line chunking" (one code
path for gate + fallback).

### T3 — Gate in `chunkByFormat` + dedupe-skip meta

Add `chunkByFormatWithMeta(text, source?) → { chunks, semantic }`; keep
`chunkByFormat(text)` as a thin back-compat wrapper (`.chunks`). Semantic
branch is FIRST (before detectors). Local `FilterSource` shape `{ kind, path? }`
in parsers (no import from types.ts → no cycle).

### T4 — Wire callsite in `types.ts` (compressor skip + dedupe skip)

Guard compress block on `!isFileSource`; call `chunkByFormatWithMeta(...,
source)`; `const deduped = semantic ? ranked : dedupe(ranked)`. End-to-end
tests via `filterOutput`: `.ts` file → function-aligned excerpts; structurally-
similar `.json` keys survive (no dedupe drop); command source → line chunks
unchanged; unsupported ext → line chunks.

### T5 — Changeset

`@megasaver/output-filter` minor. `@megasaver/indexer` NOT bumped (its public
surface is unchanged — output-filter only consumes existing exports).

## Definition of Done

`pnpm verify` green (biome + tsc -b + vitest). Expand-chunk contract intact
(ids still array-order numeric downstream; no change there). Code-reviewer +
critic pass (HIGH risk). Changeset present.
