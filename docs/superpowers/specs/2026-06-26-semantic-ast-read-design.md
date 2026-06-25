---
feature: semantic-ast-read
date: 2026-06-26
risk: HIGH
status: approved-design
build-order: "3 of 3 (#2 done, #1 done -> #3)"
---

# Semantic AST Read — Design Spec

## Problem

When Mega Saver filters a SOURCE-file read, it chunks the file with
`chunkByLines(text, 40)` — fixed 40-line windows with no regard for code
structure. A function that spans lines 30–55 is split across two chunks
(1–40 and 41–80); the second chunk also carries the head of the next
function. The ranker (`scoreChunk` → `applyEngineRanking`) then scores
these incoherent fragments: keyword hits land in the wrong window, a
function's signature and body can end up in different chunks, and
`fitBudget` may keep half a function and drop the other half. The result
is that intent-driven reads return mangled, mid-declaration excerpts that
read worse than the raw file and waste budget on fragment boundaries.

The indexer already knows how to carve a source file into coherent
semantic blocks (functions, classes, schemas, docs sections, config keys)
via `extractTs` / `extractMd` / `extractJson`. We are not reusing that
knowledge on the read path. This spec closes that gap.

## Goal

For a file read whose path has a supported extension, produce AST-aligned
chunks — one chunk per semantic declaration, plus line-chunks for any gaps
between/around declarations — so the existing
`scoreChunk → dedupe → fitBudget` pipeline ranks and fits whole, coherent
units instead of arbitrary line windows. The change is a **drop-in at the
chunk-production step only**: the chunker still returns `Chunk[]` of shape
`{ text, startLine, endLine }`, ids are still assigned numerically
downstream, and every other stage is untouched. Everything that is not a
supported file read keeps the existing line-chunk behavior, byte for byte.

## Non-Goals (YAGNI — decision 7)

- **No persisted index.** The indexer's `store` / `build` / `scan` paths
  are not invoked. We parse the in-memory string per read.
- **No AST cache across reads.** The file text is already in memory; a
  re-parse on the next read is cheap and avoids cache-invalidation bugs.
- **No cross-file analysis.** No `calls` / `calledBy` / dependency graph
  use. We consume only `startLine` / `endLine` from each block.
- **No new parser dependency.** No tree-sitter, no Babel. We reuse
  `typescript@5.7.3`, already a transitive dependency via `@megasaver/indexer`.
- **No change to scoring.** `scoreChunk`, the keyword weights, and
  `applyEngineRanking` are unchanged. `dedupe`'s *implementation* is also
  unchanged, but its *invocation is skipped for the semantic path* — see
  §6 "Dedupe vs. the partition invariant" for why running it there would
  silently drop coherent chunks and violate the partition invariant.
- **No change to expand-chunk storage.** Chunk-set persistence and the
  `(chunkSetId, chunkId)` fetch contract are untouched (see Data Flow).
- **No change to the format detectors** (pytest, cargo, eslint, …) for
  command/grep/fetch output. Only the file-read branch is added. The
  command-output *compressor* (tsc/vitest, §10.4) is unchanged for
  command/grep/fetch but is **skipped for file sources** (§2a) so the
  chunker never parses a rewritten summary.

## Locked Decisions (transcribed)

1. **Semantic chunker, drop-in at chunk production.** Add a SEMANTIC
   chunker to `@megasaver/output-filter` that, for SOURCE files, produces
   AST-based chunks (functions/classes/etc.) instead of naive line chunks.
   It is a DROP-IN at the chunk-production step — same `Chunk` shape
   `{ text, startLine, endLine }` fed into the existing
   `scoreChunk → dedupe → fitBudget` pipeline. Chunk ids are assigned
   DOWNSTREAM (numeric `"0".."n"`) so the expand-chunk contract is
   automatically preserved.

2. **Reuse the indexer's extractors.** Import `extractTs` (and `extractMd`,
   `extractJson`) from `@megasaver/indexer`. Do NOT add tree-sitter/babel —
   `typescript` (TS compiler API) is already an indexer dependency. Add
   `"@megasaver/indexer": "workspace:*"` to
   `packages/output-filter/package.json` (and a tsconfig project reference
   IF the repo uses TS project refs — it does not; see Dependency note).
   Dependency direction output-filter → indexer is cycle-safe (verified:
   indexer depends only on shared/retrieval/policy; content-store depends on
   output-filter; no cycle).

3. **Gating.** Only AST-chunk when `source.kind === "file"` AND the path
   extension is supported. Supported: `extractTs` for
   `.ts/.mts/.cts/.tsx/.jsx/.js/.mjs/.cjs`; `extractMd` for `.md`;
   `extractJson` for `.json`. Everything else (command/grep/fetch source,
   unsupported extension, missing source) → the EXISTING `chunkByLines`
   path (via `chunkByFormat`'s detectors), unchanged.

   **The command-output compressor MUST be skipped for `source.kind ===
   "file"`** so the semantic chunker parses the ORIGINAL file text, never a
   rewritten summary. See "Compressor / chunker ordering" below for why this
   is load-bearing and not optional.

4. **Fallback / robustness.** If the extractor throws OR returns zero
   blocks, fall back to `chunkByLines` for that input. Never throw out of
   the chunker — a parse failure must degrade to line chunking, never break
   a read.

5. **Gap-filling.** The extractor returns spans for declarations but may
   not cover the whole file (imports, top-level code between declarations,
   JSON value bodies). Partition the WHOLE file into chunks: emit one chunk
   per extracted block span, and emit line-chunk(s) for any line ranges NOT
   covered by a block, so every line is in exactly one chunk (ranking must
   see the entire file; nothing silently dropped). Order chunks by
   `startLine`.

6. **Oversized block.** A single semantic block larger than the budget
   would be skipped whole by `fitBudget` (leaving a gap). When a block's
   text exceeds a threshold (use the mode budget, or a sane line cap),
   sub-split that block into line-chunks (reuse `chunkByLines` on the
   block's text, remapping `startLine` offsets) so its parts can be
   ranked/fit individually instead of dropped.

7. **Scope (YAGNI).** No new persisted index, no caching of parsed ASTs
   across reads (parse per read is fine — file already in memory), no
   cross-file analysis, no change to `scoreChunk`/keyword weights, no change
   to the expand-chunk storage. Only the chunk-PRODUCTION step changes,
   behind the source/extension gate.

## Components

All changes live in `packages/output-filter/`.

### 1. Semantic chunker function — `src/parsers/semantic.ts` (new)

```ts
export function chunkBySemantic(text: string, path: string): Chunk[] | null
```

- Picks the extractor by extension: `extractTs` for the JS/TS family,
  `extractMd` for `.md`, `extractJson` for `.json`. (Extension dispatch is
  the single source of truth for "supported".)
- Calls the extractor inside a `try`. On throw → return `null`
  (caller falls back). On zero blocks → return `null` (decision 4).
- On ≥1 block: build the full partition (gap-fill + oversize sub-split,
  below) and return `Chunk[]` ordered by `startLine`.
- Returns `null` (never throws) to signal "use line chunking" so the gate
  and the fallback are one code path.

Helper, exported for unit tests:

```ts
export function partitionFile(
  text: string,
  blocks: ReadonlyArray<{ startLine: number; endLine: number }>,
  budgetBytes: number,
): Chunk[]
```

`blocks` is the minimal shape `partitionFile` needs — only the line span.
The full `ExtractedBlock` is mapped down to this at the call boundary so
the partition logic has no indexer coupling and is trivially testable.

### 2. Gating in `chunkByFormat` — `src/parsers/index.ts` (edit)

Current signature: `chunkByFormat(text: string): Chunk[]`. New signature
threads the read's source so it can choose semantic vs detectors vs lines:

```ts
export function chunkByFormat(text: string, source?: FilterSource): Chunk[]
```

The semantic branch is the FIRST check, **before** the command-output
detectors (pytest/cargo/eslint/test-output/ts-diagnostic/stacktrace):

```ts
export function chunkByFormat(text: string, source?: FilterSource): Chunk[] {
  if (source?.kind === "file") {
    const semantic = chunkBySemantic(text, source.path);
    if (semantic !== null) return semantic;        // gate + fallback in one
  }
  if (detectPytest(text)) return parsePytest(text);
  // … unchanged detector chain …
  return chunkByLines(text, DEFAULT_LINES_PER_CHUNK);
}
```

Ordering rationale: a `.ts` file whose text happens to look like a
stacktrace must be parsed as source, not as a stacktrace. Putting the
file/extension gate first guarantees that. For non-file sources or
unsupported extensions, `chunkBySemantic` is never called (or returns
`null`), and the existing detector chain runs exactly as today.

`FilterSource` is the discriminated union already in scope at the callsite
(`source` from `parsed.data`); pass it through. Only `kind` and (for files)
`path` are read.

### 2a. Compressor / chunker ordering (CRITICAL — gap fix)

Threading `source` into `chunkByFormat` is necessary but NOT sufficient. The
real callsite (`src/types.ts` ~L166-173) runs **classify → compress BEFORE
chunking**, and feeds the *compressed* text into the chunker:

```ts
let textForChunks = normalized;
if (decision === "compressed" && isConfidentClassification(classification)) {
  const compressed = compressByCategory(classification.category, normalized);
  textForChunks = compressed.text;          // ← REWRITTEN text
}
const chunks = chunkByFormat(textForChunks);  // ← chunker sees the summary
```

For a file read this is actively corrupting, because the classifier is
content-only when `source.kind === "file"`:

- `command` is `undefined` for a file read (`types.ts` builds `command` only
  for `source.kind === "command"`), so `classifyOutput` sniffs CONTENT alone.
- `classify.ts` `TS_OUT = /\(\d+,\d+\):\s+error\s+TS\d+:|error\s+TS\d+:|Found\s+\d+\s+errors?/m`
  matches on body text. Any large `.ts`/`.tsx` whose body merely *contains*
  the literal `error TS1234:` — a test fixture, an error-template string, a
  doc comment, a snapshot — classifies as `typescript` with confidence `0.7`
  (the `tsOut`-only branch), which clears `CLASSIFICATION_CONFIDENCE_FLOOR`
  (`0.5`), so `isConfidentClassification` is `true`.
- `compressByCategory("typescript", …)` (`compress/tsc.ts`) then REBUILDS the
  text into a synthetic "Top files by error count" summary with a completely
  different line structure.

`chunkBySemantic` would then parse/slice that synthetic blob, while `extractTs`
returns line spans for the ORIGINAL file. Every `startLine`/`endLine` would be
wrong, the partition invariant would be meaningless, and the read would return
garbage. The earlier data-flow note `chunkBySemantic(text, source.path)` is
misleading: `text` at the callsite is the compressor output, not the file.

**Fix (locked, decision 3 + 7-safe): the command-output compressor never runs
for file sources.** Guard the compress block on the source kind so the
ORIGINAL `normalized` text reaches the chunker for every file read:

```ts
let textForChunks = normalized;
const isFileSource = source?.kind === "file";
if (decision === "compressed" && !isFileSource && isConfidentClassification(classification)) {
  const compressed = compressByCategory(classification.category, normalized);
  compressor = compressed.compressor;
  textForChunks = compressed.text;
}
const chunks = chunkByFormat(textForChunks, source);   // file ⇒ un-compressed
```

Why skip rather than reorder: the tsc/vitest compressors are *command-output*
compressors (§10.4 — they summarize tool runs). A file read is never a
command run; classifying file BODIES as command output is a category error to
begin with. Skipping for `source.kind === "file"` is the smallest correct
change, keeps the compressor untouched for command/grep/fetch, and guarantees
the semantic chunker always sees the real file. `compressor` stays `"generic"`
for file reads, which is accurate. `// ponytail: one guard at the compress
block beats teaching every command compressor to recognize file sources.`

This is additive to the gate in §2: the §2 gate decides semantic-vs-line; this
guard guarantees the text fed to *either* path is the un-mutated file. Both are
required.

### 3. Indexer dependency

Add `"@megasaver/indexer": "workspace:*"` to
`packages/output-filter/package.json` `dependencies`. Import
`{ extractTs, extractMd, extractJson }` from `@megasaver/indexer` in
`semantic.ts`. See Dependency note for why no tsconfig change is needed.

### 4. Gap-filling partition (decision 5)

Extractors do NOT guarantee whole-file coverage. Concretely:

- `extractTs` covers only top-level declaration statements. Imports,
  top-level expression statements, and blank lines between declarations are
  NOT covered.
- `extractJson` returns **single-line** blocks (`startLine === endLine`,
  one per top-level key); the entire value body of every key is a gap. Most
  of a JSON file is uncovered — gap-filling is what makes JSON usable here.
  **Its line anchors are best-effort guesses, NOT reliable spans.**
  `extract-json.ts` `lineOf` matches an anchored regex
  `^\s*"key"\s*:` and falls back to `1` for any key it cannot locate on its
  own line — which happens for (a) minified / single-line JSON
  (`{"a":1,"b":2}`), where the anchor matches NOTHING and EVERY key collapses
  to line `1`; and (b) deeply nested or oddly-formatted keys the anchor does
  not match, even in otherwise well-formed multi-key files. So
  `extractJson` routinely emits multiple blocks all claiming
  `startLine === endLine === 1` (or otherwise out of file order). The
  partition therefore CANNOT assume JSON block spans are correct or
  non-overlapping — step 4 below normalizes them defensively.
- `extractMd` already gap-fills its own intro and each heading section runs
  to the line before the next heading, so MD coverage is near-complete; the
  partition still runs uniformly (a no-op for the covered ranges).

Algorithm (`partitionFile`):

1. Sort blocks by `startLine`.
2. Sweep a cursor from line 1 to the last line of the file. For each block,
   if there is a gap `[cursor, block.startLine - 1]`, emit line-chunk(s) for
   that gap by slicing the file's lines (default 40 lines/chunk, remapping
   `startLine` to the gap's absolute start). Then emit the block as one
   chunk (subject to oversize sub-split). Advance cursor to
   `block.endLine + 1`.
3. After the last block, emit a trailing line-chunk for any remaining
   `[cursor, lastLine]`.
4. **Overlap is REAL for JSON — normalize, don't assume.** `extractTs` /
   `extractMd` emit ordered non-overlapping spans, but `extractJson`'s
   `lineOf` fallback-to-`1` (see above) routinely produces multiple blocks
   with `startLine === endLine === 1`, or blocks out of file order — direct
   overlap, guaranteed for minified JSON. The earlier "overlap is impossible,
   the clamp is merely defensive" framing was WRONG and is retracted. The
   partition MUST handle overlap as a normal case, and the clamp MUST keep
   each emitted chunk well-formed (`endLine >= startLine`, the invariant
   `CodeBlock`/`Chunk` itself requires):

   For each block, after sorting (step 1), reconcile it against `cursor`:
   - If `block.endLine < cursor` — the block is **fully covered** by an
     already-emitted span (e.g. the 2nd, 3rd, … `startLine===endLine===1`
     JSON block once `cursor` has advanced past line 1). **Skip it entirely**
     — do not emit a chunk for it. Its line(s) are already in a prior chunk;
     re-emitting would double-cover and break the partition. The key's
     *content* is not lost: the value body lives in the gap-fill line-chunks,
     which cover the real bytes of the file.
   - Else if `block.startLine < cursor <= block.endLine` — partial overlap:
     clamp BOTH ends so the chunk stays valid and disjoint —
     `startLine = cursor` AND `endLine = max(block.endLine, cursor)`
     (guarantees `endLine >= startLine`). Slice the clamped range.
   - Else (`block.startLine >= cursor`) — no overlap; emit the gap before it,
     then the block, as in steps 2–3.

   Never emit a chunk with `startLine > endLine`; never slice a reversed or
   empty range. `// ponytail: skip-if-covered + clamp-both-ends is the whole
   fix; JSON's line anchors are guesses, so treat every block span as
   untrusted input, not a contract.`

Postcondition (invariant, asserted in tests): the union of all emitted
chunk line-ranges is exactly `[1, lastLine]` with no gaps and no overlaps —
every file line appears in exactly one chunk, and every emitted chunk
satisfies `endLine >= startLine`. This must hold even when the extractor
returns garbage spans (all-line-1 minified JSON is an explicit test case),
because step 4 normalizes untrusted spans rather than trusting them.

Line numbers from extractors are 1-indexed inclusive; `Chunk.startLine` /
`Chunk.endLine` are 1-indexed inclusive — same convention, no off-by-one
translation beyond slicing `lines[start-1 .. end]`.

### 5. Oversized-block sub-split (decision 6)

Within step 2 above, before emitting a block as a single chunk, measure its
text. If `Buffer.byteLength(blockText, "utf8") > budgetBytes` (the mode
budget passed into `partitionFile`), DON'T emit it whole — instead run
`chunkByLines(blockText, DEFAULT_LINES_PER_CHUNK)` on the block's own text
and remap each returned chunk's `startLine`/`endLine` by adding
`block.startLine - 1`. This turns one un-fittable mega-chunk into several
fittable sub-chunks that the ranker can keep or drop individually, so a
huge function's relevant half can survive `fitBudget` instead of the whole
function being skipped (leaving a silent gap).

`budgetBytes` = `effectiveBudget(maxReturnedBytes, modeToBudget(mode))`,
computed at the callsite and threaded through `chunkByFormat` →
`chunkBySemantic` → `partitionFile`. Using the actual fit budget means the
sub-split threshold tracks the real constraint `fitBudget` will apply.

### 6. Dedupe vs. the partition invariant (CRITICAL — gap fix)

`filterOutput` (`src/types.ts` ~L179) runs `dedupe(ranked)`
**unconditionally** — it is NOT gated on `decision`, so it executes on EVERY
chunk set, semantic ones included. `dedupe` (`src/dedupe.ts`) drops any chunk
whose simhash is within `HAMMING_DEDUPE_THRESHOLD = 3` bits of an
already-kept chunk.

This silently breaks decision 5's "nothing silently dropped, every line in
exactly one chunk" invariant for semantic chunks. The old 40-line windows
were large and diverse, so collisions were rare. Semantic blocks are small
and structurally near-identical by nature — several one-line JSON config
keys, repeated `export const X = …` shapes, boilerplate getters, short
functions — and routinely land within 3 bits of each other. `dedupe` would
then delete whole, distinct declarations from the excerpts. The spec proves
the partition tiles `[1, lastLine]`, then hands those chunks to a stage that
can erase several of them — so the user-visible excerpts violate the very
invariant §4 asserts. Decision 7 ("dedupe unchanged") was written without
this interaction in view; leaving dedupe untouched is therefore NOT safe for
the semantic path.

**Fix (locked): exempt semantic chunks from dedupe.** Semantic chunks are an
exhaustive partition of one file — there are by construction no true
duplicates to collapse (each chunk is a distinct, non-overlapping line
range), so dedupe has nothing legitimate to do and only ever does harm here.
The smallest correct change is to skip dedupe when the chunks came from the
semantic path:

```ts
const usedSemantic = source?.kind === "file" && /* chunkByFormat took the
  semantic branch — see below */;
const deduped = usedSemantic ? ranked : dedupe(ranked);
```

To know "did the semantic branch run" without re-deriving it, return that bit
alongside the chunks. Cheapest: have `chunkByFormat` expose whether it took
the semantic path (e.g. a sibling `chunkByFormatWithMeta` returning
`{ chunks, semantic: boolean }`, or set `usedSemantic` from the same
`source.kind === "file" && chunkBySemantic(...) !== null` condition the gate
already computes). Either way the gate condition is computed exactly once and
its boolean result decides both "use semantic chunks" and "skip dedupe".

This is surgical: `dedupe` itself, `scoreChunk`, the keyword weights, and the
command/grep/fetch paths are all byte-for-byte unchanged — dedupe still runs
on every non-semantic chunk set exactly as today. Only the semantic file-read
path opts out. `// ponytail: semantic partition has no real dups by
construction; cheapest correct move is to not run dedupe on it, not to teach
dedupe about partitions.`

Decision 7's "no change to dedupe" is amended: dedupe's *implementation* is
unchanged; its *invocation* now skips the semantic path. The verification
adds a test (see §7 of Testing) asserting a semantic partition of structurally
similar declarations (≥2 near-identical one-line JSON keys / `export const`
shapes) survives end-to-end with no chunk dropped by dedupe.

## Data Flow

```
filterOutput(input)
  └─ parsed.data.source : FilterSource (file{path} | command | grep | fetch)
  └─ normalized text
  └─ budgetBytes = effectiveBudget(maxReturnedBytes, modeToBudget(mode))
  │
  ▼  classify → compress band  ← edited (§2a)
     ├─ source.kind === "file"  → SKIP command-output compressor
     │                            textForChunks = normalized (ORIGINAL file)
     └─ else (command/grep/fetch + confident) → compress as today
  │
  ▼  chunkByFormat(textForChunks, source)         ← edited
     │   (file ⇒ textForChunks is the un-compressed file, per §2a)
     ├─ source.kind === "file" && supported ext?
     │     └─ chunkBySemantic(text, source.path)  ← new   (usedSemantic=true)
     │           ├─ pick extractor by ext
     │           ├─ extractor(path, text) → ExtractedBlock[]   (try/catch)
     │           │     ├─ throws       → return null ──┐ (usedSemantic=false)
     │           │     └─ [] (zero)    → return null ──┤ (usedSemantic=false)
     │           └─ partitionFile(text, blocks, budget)│  (gap-fill + oversize
     │                 └─ Chunk[] (ordered by startLine)│   + clamp untrusted
     │                                                  ▼   spans, §4 step 4)
     └─ else / null ───────────────────────────► detector chain → chunkByLines
  │
  ▼  Chunk[]  { text, startLine, endLine }   ← SAME shape, no id
  │
  ▼  scoreChunk (map)        ← unchanged
  ▼  applyEngineRanking      ← unchanged (env-gated)
  ▼  dedupe                  ← SKIPPED when usedSemantic (§6); else unchanged
  ▼  fitBudget(chunks, budget) ← unchanged
  │
  ▼  excerpts / result        ← unchanged
  │
  ▼  downstream persist (context-gate persistChunkSet / record-output.ts)
        assigns numeric ids "0".."n" in array order   ← UNCHANGED
  ▼  expand-chunk fetch by (chunkSetId, chunkId)        ← UNCHANGED
```

The semantic chunker outputs the exact `Chunk[]` contract the rest of the
pipeline already consumes. Because ids are assigned downstream in array
order, a multi-chunk semantic result needs zero id handling here and the
expand-chunk contract is preserved automatically (decisions 1 & 5).

## Error Handling (decision 4)

- Extractor throws (malformed TS the compiler chokes on, etc.) → caught in
  `chunkBySemantic`, return `null`, caller uses the detector/line path.
- Extractor returns `[]` (heading-less `.md`, non-object JSON, a `.ts` file
  with only imports and no declarations) → return `null`, fall back to line
  chunking so the file is still returned in 40-line windows.
- `chunkBySemantic` NEVER throws. The `try` wraps the extractor call; the
  partition logic operates on already-validated line numbers and pure
  string slicing, so it cannot throw on well-formed extractor output.
- A parse failure therefore degrades gracefully to today's behavior; it can
  never break a read. This is the core HIGH-risk mitigation.

## Dependency note

`@megasaver/output-filter` does NOT currently depend on
`@megasaver/indexer`. Adding the dependency is **cycle-safe** (verified):

```
indexer        → shared, retrieval, policy          (no output-filter)
output-filter  → policy, shared, (+ indexer NEW)
content-store  → output-filter                       (depends on us, not we on it)
```

No edge from indexer back to output-filter, so output-filter → indexer
introduces no cycle.

**No tsconfig change is required.** Both packages set
`"composite": false` and neither `tsconfig.base.json`,
`packages/output-filter/tsconfig.json`, nor
`packages/indexer/tsconfig.json` has a `references` array — the repo does
NOT use TS project references. `tsc -b` / `tsup` resolve the cross-package
import through the pnpm workspace symlink in `node_modules` against
`@megasaver/indexer`'s published `exports` (`types` → `dist/index.d.ts`).
The conditional "add the tsconfig project reference" from decision 2 is
therefore a no-op for this repo and must NOT be added (adding a phantom
reference array would itself drift the build). Run `pnpm install` after the
`package.json` edit so the workspace symlink is created.

TS-config compliance for new code: `strict`,
`exactOptionalPropertyTypes` (conditional spread for optional props),
`noPropertyAccessFromIndexSignature` (bracket-access + biome-ignore where a
`Record` index signature is hit), ESM `.js` import specifiers, NodeNext.

## Testing strategy (TDD — tests first)

New file `packages/output-filter/test/semantic.test.ts`, plus
end-to-end assertions in the existing
`packages/output-filter/test/filter-output.test.ts`. Vitest.

Unit — `chunkBySemantic` / `partitionFile`:

1. **Supported TS file → boundary-aligned chunks.** A `.ts` source with two
   top-level functions yields chunks whose `startLine`/`endLine` match each
   function's real boundaries (assert each function body is intact in a
   single chunk, not split mid-declaration).
2. **Gap-fill covers the whole file (invariant).** For a `.ts` file with
   imports, a top-level constant, and functions, assert the union of all
   chunk ranges is exactly `[1, lastLine]` — no gap, no overlap, every line
   covered (decision 5 postcondition). Same assertion for a `.json` file
   (where extractor blocks are single-line and gap-fill carries the value
   bodies).
3. **Oversized block sub-split.** A single function whose text exceeds the
   passed `budgetBytes` is emitted as ≥2 line-chunks (not one), with
   correctly remapped absolute `startLine`/`endLine`; assert no resulting
   sub-chunk exceeds the line cap and ranges still tile the block exactly
   (decision 6).
4. **Unsupported extension → null / line chunks.** `.py`, `.rs`, `.txt`
   file source → `chunkBySemantic` returns `null`; `chunkByFormat`
   produces the same chunks as `chunkByLines(text, 40)` (or a matching
   detector). Byte-identical to pre-change behavior.
5. **Parse error → line-chunk fallback.** Feed `extractTs` a deliberately
   broken input that makes it throw → `chunkBySemantic` returns `null`,
   read still succeeds via line chunking (decision 4).
6. **Zero blocks → line-chunk fallback.** A heading-less `.md` and a
   `.ts` file containing only imports (no declarations) each → `null` →
   line chunking.
7. **Untrusted JSON spans → valid partition (gap #3/#4).** A minified
   single-line JSON object (`{"a":1,"b":2,"c":3}`) where `extractJson`
   returns N blocks all with `startLine === endLine === 1` → `partitionFile`
   still satisfies the invariant: union is exactly `[1, lastLine]`, NO chunk
   has `startLine > endLine`, no line double-covered. Also a multi-key
   pretty-printed JSON with one key the anchor cannot locate (forced
   `lineOf → 1`) → same invariant holds (the mis-located block is
   skipped-if-covered or clamped, never emitted reversed). Assert no chunk
   slice is empty or reversed.

Gating — `chunkByFormat`:

8. **Non-file sources → unchanged.** `source.kind` of `command`, `grep`,
   `fetch` (and `source` undefined) never invoke the semantic path; the
   detector chain / line chunks run exactly as today. Snapshot/structural
   equality against current outputs for representative command output.

End-to-end — `filterOutput`:

9. **Expand-chunk contract intact.** Through `filterOutput` on a supported
   file read, the produced multi-chunk result, once persisted via the
   context-gate path, assigns ids `"0".."n"` in array order and
   `expand-chunk(chunkSetId, chunkId)` returns the exact chunk text for each
   id. Assert ids are contiguous and stable and that fetching the last id
   returns the trailing chunk (no id handling regressions from the
   multi-chunk semantic result).
10. **File body that looks like tsc output is NOT compressed (gap #1).** A
    large `.ts` file read whose BODY contains the literal `error TS1234:`
    (e.g. an error-template string or test fixture) → `classifyOutput`
    returns `typescript@0.7` on content alone, but because `source.kind ===
    "file"` the compressor is SKIPPED (§2a): `result.compressor === "generic"`
    and the excerpts are function-aligned slices of the ORIGINAL file (the
    literal source line is present verbatim), NOT a synthetic "Top files by
    error count" summary. Regression test for the compressor-before-chunk
    corruption. Confirm the SAME content as `source.kind === "command"`
    (`tsc`) still DOES compress (compressor !== "generic"), proving the skip
    is file-scoped.
11. **Dedupe does not drop coherent semantic chunks (gap #2).** A `.json`
    file with ≥3 structurally near-identical one-line keys (or a `.ts` file
    with ≥3 near-identical `export const X = …` declarations) through
    `filterOutput` on the semantic path: assert every distinct declaration
    survives into `excerpts` — the chunk count after the (skipped) dedupe
    stage equals the partition's chunk count for the ranges that fit budget;
    no near-duplicate is silently collapsed. Contrast: the same near-identical
    text as a `command` source still dedupes as today.

Reuse existing extractor tests (`packages/indexer/test/extract-ts.test.ts`)
as the source of truth for extractor behavior; do NOT re-test extractor
internals here — only the partition/gate/fallback logic this package adds.

## Risk

**HIGH** (§12 — compression core chunker; the read path is a core product
surface). De-risking factors baked into the design:

- **Gated on `source.kind === "file"`:** the three new behaviors — semantic
  chunking (§2), the command-output-compressor skip (§2a), and the
  dedupe skip (§6) — ALL fire only for file sources. Every command / grep /
  fetch input path is byte-for-byte unchanged (compressor runs, dedupe runs,
  detectors run exactly as today). Tests 8/10/11 pin the file-vs-command
  contrast.
- **Fallback everywhere:** unsupported ext, non-file source, extractor
  throw, and zero-blocks all route to the existing `chunkByLines` path. When
  the semantic branch does NOT run, dedupe is NOT skipped — the skip is tied
  to the same `usedSemantic` boolean that selects the chunks.
- **Untrusted spans normalized, not trusted:** the partition treats every
  extractor span (especially `extractJson`'s frequently-`1` line anchors) as
  untrusted input and clamps/skips to keep the invariant, so a degenerate
  extractor cannot produce a reversed or overlapping chunk (test 7).
- **No storage / scoring / id changes:** `scoreChunk`, keyword weights, the
  `dedupe`/`fitBudget` implementations, chunk-set persistence, and the
  expand-chunk contract are untouched. The blast radius is the
  chunk-production step plus two file-scoped invocation guards
  (compressor skip, dedupe skip).

Required per §12 HIGH: `omc:architect` design pass + `omc:critic`
adversarial review (separate contexts) + `code-reviewer`. Worktree
isolation (already on `feat/semantic-ast-read`, never edit `main`).
**Changeset required:** `@megasaver/output-filter` **minor** (new gated
behavior, public `filterOutput` surface unchanged). `@megasaver/indexer`
gets a changeset ONLY if its public surface changes — it does not (we only
consume existing exports), so no indexer changeset.

## Definition of Done deltas

Beyond the standard §9 DoD:

1. This spec in `docs/superpowers/specs/` (done) + plan in
   `docs/superpowers/plans/`.
2. Tests written first (TDD); all eleven scenarios above green —
   including the three gap-fix regressions (7 untrusted-JSON-spans,
   10 file-body-looks-like-tsc-not-compressed, 11 dedupe-keeps-semantic).
3. `pnpm verify` green — `biome check`, `tsc -b --noEmit`, `vitest run`.
   Run `pnpm exec biome check <changed files>` before each commit (CI
   `biome check .` fails on any committed lint/format issue; known
   cruft-only local failures are out of scope).
4. `pnpm install` re-run after `package.json` edit so the workspace
   symlink to `@megasaver/indexer` exists (otherwise import resolution and
   typecheck fail).
5. Smoke evidence: a captured `filterOutput` run on a real `.ts` file
   showing function-aligned excerpts (with `compressor === "generic"`,
   proving the §2a file-source compressor skip), AND an `expand-chunk`
   round-trip showing ids `"0".."n"` resolve.
6. `code-reviewer` AND `critic` passes (separate contexts), `omc:verify`
   evidence pass.
7. Changeset added: `@megasaver/output-filter` minor.
8. **Explicit-path git only.** The working tree has ~14 pre-existing
   untracked cruft files; NEVER `git add -A` / `git add .`. Stage only the
   files this feature touches:
   `packages/output-filter/src/parsers/semantic.ts`,
   `packages/output-filter/src/parsers/index.ts`,
   `packages/output-filter/src/types.ts` (the §2a compressor-skip guard and
   the §6 dedupe-skip guard live at the `filterOutput` callsite),
   `packages/output-filter/package.json`,
   `pnpm-lock.yaml`,
   `packages/output-filter/test/semantic.test.ts`,
   `packages/output-filter/test/filter-output.test.ts`,
   the changeset file, this spec, and the plan. Commit on
   `feat/semantic-ast-read`; never switch branches.
9. No `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` change needed (no
   convention change).
