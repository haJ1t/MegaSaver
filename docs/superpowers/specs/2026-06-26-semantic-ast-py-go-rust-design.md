---
feature: semantic AST read for Python/Go/Rust
date: 2026-06-26
risk: HIGH
status: approved-design
reviewers: [code-reviewer, critic]
---

# Semantic AST Read for Python / Go / Rust

## Problem

Semantic AST read (#182) makes reads of supported source files emit
AST-aligned chunks (whole functions/classes/blocks) instead of naive
fixed-size line slices, so the ranker fits whole semantic units to the
budget. Today only TypeScript/JS (`extract-ts.ts`), Markdown
(`extract-md.ts`), and JSON (`extract-json.ts`) are wired into
`chunkBySemantic`. Reads of `.py`, `.go`, and `.rs` files fall through
`isSupportedSource` → `null` → `chunkByLines`, so a Python module read
gets sliced at arbitrary line offsets that cut functions in half. The
three languages are common in agent workloads and currently get the
worst-case excerpting.

## Goal

Extend semantic AST read to Python (`.py`), Go (`.go`), and Rust
(`.rs`) so reads of those source files produce AST-aligned chunks
aligned to top-level declaration boundaries instead of naive line
slices — using **zero new dependencies**.

Success criteria (verifiable):

1. `chunkBySemantic(src, "x.py" | "x.go" | "x.rs")` returns a
   non-null `Chunk[]` whose chunks align to top-level decl
   boundaries, and the partition is exhaustive over non-blank lines
   (`assertExhaustivePartition`).
2. Per-language extractor unit tests assert correct top-level spans
   for functions and the language's type/class/struct construct.
3. Unsupported ext / zero-block / throw still collapses to `null`
   (caller falls back to `chunkByLines`) — existing behavior intact.
4. `no-eager-typescript.test.ts` stays green: importing
   `@megasaver/output-filter` loads zero `typescript` modules.
5. `pnpm verify` green; changeset present.

## Non-Goals (YAGNI)

- **NO parser dependency.** No tree-sitter, web-tree-sitter, wasm,
  babel, or any language-grammar lib. None exists in the repo and none
  is added. `partitionFile` only needs `{startLine,endLine}`, and the
  lazy-load TS-compiler lesson (#182 fix) says keep heavy parsers off
  the core import path.
- No nested declaration detection (methods inside a class, inner
  functions). Top-level only; gap-fill covers everything else.
- No cross-reference analysis: `imports`, `exports`, `calls`,
  `calledBy` are all `[]`.
- No new `blockType` enum values — reuse existing literals.
- No change to ranking/scoring, `partitionFile`, `chunkByLines`, the
  oversize cap, or the gap-fill / whitespace-drop logic (#183).
- No perfect parser. "Good top-level spans" is the bar; mis-spans are
  tolerable because chunks stay valid and the fallback keeps output
  correct.
- No invocation-site changes: `chunkBySemantic` already dispatches by
  extension; only the dispatch table and three extractors are added.

## Locked Decisions

These are fixed. Do not deviate.

1. **Extend semantic AST read (#182) to `.py`, `.go`, `.rs`** so reads
   of those source files produce AST-aligned chunks instead of naive
   line slices.

2. **Parser = zero-dependency heuristic line-based extractors.** Do
   NOT add tree-sitter, web-tree-sitter, wasm, babel, or any parser
   dependency. Pure functions, no I/O, cannot throw out of the
   extractor (`chunkBySemantic` already wraps the call in try/catch →
   `null` → `chunkByLines` fallback, but the extractors must defend
   their own scans regardless).

3. **New extractors live in `packages/indexer/src/extract/` as
   `extract-py.ts`, `extract-go.ts`, `extract-rs.ts`**, each exporting
   `extractPy` / `extractGo` / `extractRs (filePath, source):
   ExtractedBlock[]`, re-exported from
   `packages/indexer/src/index.ts`. Mirror `extract-md.ts` EXACTLY for
   the `ExtractedBlock` shape:

   ```ts
   // name is OPTIONAL here. extract-md.ts / extract-json.ts both take a
   // `name: string` that is ALWAYS present, so they hardcode `name,` and
   // `tokenize(name)`. py/go/rs CANNOT: Go names are best-effort (omit
   // when absent), and the Rust /^(pub\s+)?(struct|enum|trait|mod|impl)\b/
   // probe captures NO name for the construct keyword. So this template
   // diverges from extract-md.ts on exactly the name handling — do NOT
   // copy md's unconditional `name,` / `tokenize(name)`.
   {
     filePath,
     startLine,
     endLine,
     blockType,                     // valid literal from code-block.ts
     ...(name !== undefined ? { name } : {}),  // conditional spread; see TS note
     contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
     imports: [],
     exports: [],
     calls: [],
     calledBy: [],
     keywords: tokenize(name ?? ""),  // tokenize("") === [] (safe); tokenize(undefined) THROWS
   }
   ```

   Why the divergence is mandatory (verified): under
   `exactOptionalPropertyTypes`, a literal `name: undefined` (what a
   bare `name,` produces when the regex capture misses) is a type error
   — the file will not `tsc`. And `tokenize(undefined)` throws
   `TypeError: Cannot read properties of undefined (reading 'replace')`
   inside `extractor(path, text)`, aborting extraction for the WHOLE
   file (not one block) → `chunkBySemantic` try/catch → `null` →
   `chunkByLines`. That would silently defeat semantic chunking for any
   Rust file with an `impl`/`mod` block or any Go file with a
   `var (` / `const (` group — the most common name-less top-level
   constructs. The conditional spread + `tokenize(name ?? "")` above
   makes an absent name a no-op, never a crash.

   `blockType` MUST be a valid literal from `code-block.ts`'s
   `blockTypeSchema` enum: `"function" | "class" | "component" |
   "route" | "test" | "config" | "schema" | "docs"`. Pick the closest
   existing literal; do NOT invent new enum values. Mapping (locked):

   | Language construct                  | `blockType`  |
   |-------------------------------------|--------------|
   | Python `def` / `async def`          | `"function"` |
   | Python `class`                      | `"class"`    |
   | Go `func`                           | `"function"` |
   | Go `type` / `var (` / `const (`     | `"schema"`   |
   | Rust `fn` / `async fn`              | `"function"` |
   | Rust `struct` / `enum` / `trait`    | `"schema"`   |
   | Rust `impl` / `mod`                 | `"class"`    |

   Rationale: `"class"` is the nearest literal for grouping/namespace
   constructs (Python class, Rust impl/mod); `"schema"` is the nearest
   for type/data declarations (Go type/var/const groups, Rust
   struct/enum/trait). These choices affect ranking weight only, never
   correctness — the partition is exhaustive regardless of label.

4. **Top-level block detection (heuristic, top-level only.** Nested
   decls are intentionally out of scope; gap-fill covers the rest.)

   - **Python:** lines matching `^(async\s+)?def\s` or `^class\s` at
     indentation 0. Block END = the line before the next
     indentation-0 non-blank line (indentation-based), or EOF.
     Decorators directly above a `def` at col 0 may be treated as
     their own gap — acceptable.
   - **Go:** top-level `^func\s`, `^type\s`, `^var\s\(`, `^const\s\(`.
     If the decl line opens a brace/paren, block END = the line where
     brace/paren depth returns to 0 (count `{` `}` or `(` `)` from the
     decl line). Single-line decls span 1 line.
   - **Rust:** top-level `^(pub\s+)?(async\s+)?fn\s`,
     `^(pub\s+)?(struct|enum|trait|mod|impl)\b`. Block END =
     brace-balanced end (`{` `}` depth back to 0), or 1 line for
     `;`-terminated decls.
   - Keep the brace/indent scanning SIMPLE; correctness target is
     "good top-level spans", not a perfect parser. Never throw — wrap
     risky scans defensively. Mis-spans are tolerable (chunks stay
     valid; `partitionFile` + fallback keep output correct).

5. **Dispatch in `packages/output-filter/src/parsers/semantic.ts`:**
   add `PY_EXT=/\.py$/`, `GO_EXT=/\.go$/`, `RS_EXT=/\.rs$/`;
   `extractorFor` returns `extractors.extractPy` / `extractGo` /
   `extractRs` for those; `isSupportedSource` includes them. The
   fallback path (unsupported ext / zero blocks / throw → `null` →
   `chunkByLines`) stays intact.

6. **Lazy-load preserved.** Extractors live in `@megasaver/indexer`,
   which `semantic.ts` already lazy dynamic-imports (`await import`).
   Pure heuristic extractors add ZERO eager weight — they import only
   `../code-block.js` (type-only) and `./helpers.js`. The
   `packages/output-filter/test/no-eager-typescript.test.ts` guard
   MUST stay green (no new static import of anything heavy into
   output-filter).

7. **Scope (YAGNI):** top-level decls only; `imports` / `exports` /
   `calls` / `calledBy` = `[]` (no cross-ref analysis); no new
   dependency; no wasm; no change to ranking/scoring or
   `partitionFile`. Only new extractors + the 3 dispatch lines.

## Components

1. **`packages/indexer/src/extract/extract-py.ts`** — `extractPy`,
   heuristic indentation-based top-level block extractor (Python).
2. **`packages/indexer/src/extract/extract-go.ts`** — `extractGo`,
   heuristic brace/paren-balanced top-level block extractor (Go).
3. **`packages/indexer/src/extract/extract-rs.ts`** — `extractRs`,
   heuristic brace-balanced top-level block extractor (Rust).
4. **`packages/indexer/src/index.ts`** — three new re-export lines
   (`export * from "./extract/extract-py.js"` etc.).
5. **`packages/output-filter/src/parsers/semantic.ts`** — three new
   `*_EXT` regexes, three `extractorFor` branches, three
   `isSupportedSource` clauses.

Each extractor mirrors `extract-md.ts`'s shape via a local `block()`
builder using `hashText` + `tokenize` from `./helpers.js`. It imports
only `type { ExtractedBlock } from "../code-block.js"` and the helpers
— no `typescript`, no `ts`, nothing heavy.

## Data Flow

```
read .py/.go/.rs file
  → chunkBySemantic(text, path)            [output-filter/semantic.ts]
      isSupportedSource(path)? ── no ──► null ──► chunkByLines (fallback)
        │ yes
      extractorFor(path, await loadExtractors())   [lazy import @megasaver/indexer]
        → extractPy | extractGo | extractRs
      try { blocks = extractor(path, text) } catch { return null }
      blocks.length === 0 ? null  (→ caller falls back)
        │
      partitionFile(text, blocks, OVERSIZE_BLOCK_LINES)
        → AST-aligned Chunk[] (gap-fill + oversize sub-split + whitespace-drop)
```

`partitionFile` consumes only `{startLine,endLine}`; it gap-fills
uncovered ranges (imports, blank separators, anything between
top-level decls), sub-splits oversize blocks (>80 lines) into line
windows, and drops whitespace-only gaps (#183). The extractors supply
spans; everything downstream is unchanged.

## Heuristic Detail Per Language

All three extractors: `const lines = source.split("\n")`, scan line
indices, build spans, and use a shared `block(startLine, endLine,
name, blockType)` builder identical in shape to `extract-md.ts`. Names
come from the decl line (regex capture); `tokenize(name)` fills
`keywords`. Every scan is bounded by `lines.length` and wrapped so it
cannot throw.

### Python (`extract-py.ts`)

- Detect: a line at indentation 0 matching
  `/^(async\s+)?def\s+([A-Za-z_]\w*)/` → `blockType "function"`, or
  `/^class\s+([A-Za-z_]\w*)/` → `blockType "class"`.
- Block END (indentation-based): scan forward from the decl line; END
  = the line before the next indentation-0 **non-blank** line, or EOF.
  A line is "indentation 0" if it starts with a non-whitespace char
  (`/^\S/`). Blank lines and indented lines belong to the current
  block.
- A decorator line (`^@`) directly above a `def`/`class` at col 0 is
  not a decl start; it falls into the preceding gap (acceptable per
  Locked Decision 4).
- Single top-level statements that are not `def`/`class` are not
  blocks; gap-fill covers them.

### Go (`extract-go.ts`)

- Detect (line start, top-level): `/^func\s/` → `"function"`;
  `/^type\s/`, `/^var\s*\(/`, `/^const\s*\(/` → `"schema"`. Name
  capture best-effort from the decl line (e.g. `func` name, `type`
  name); when absent, omit `name` (see TS note).
- Block END (delimiter-balanced): from the decl line, count `{`/`}`
  and `(`/`)` deltas per line. If the decl line opens a delimiter
  (net depth > 0 after the decl line), END = the first subsequent line
  where the running depth returns to 0. If the decl line never opens a
  delimiter (single-line `var (`-less `type Foo int`, etc.), the block
  spans 1 line.
- Delimiter counting is naive (no string/comment awareness). This can
  mis-span a decl containing `{` inside a string literal; acceptable
  (Locked Decision 4) — the chunk is still valid and the partition
  stays exhaustive.

### Rust (`extract-rs.ts`)

- Detect (line start, top-level):
  `/^(pub\s+)?(async\s+)?fn\s+([A-Za-z_]\w*)/` → `"function"`;
  `/^(pub\s+)?(struct|enum|trait|mod|impl)\b/` → `"schema"` for
  `struct`/`enum`/`trait`, `"class"` for `impl`/`mod` (per Locked
  Decision 3 mapping). Name capture best-effort.
- Block END (brace-balanced): from the decl line, count `{`/`}`
  deltas. If a `{` opens, END = the line where brace depth returns to
  0. If the decl is `;`-terminated on its own line (e.g.
  `struct Foo;`, a unit struct, or `pub mod x;`), the block spans 1
  line.
- Same naive-counting caveat as Go; acceptable.

### Shared invariants (all three)

- Spans are emitted in source order; `partitionFile` re-sorts and
  defends overlap regardless.
- `endLine >= startLine` always (a decl with a broken/never-closing
  delimiter clamps END to EOF; `partitionFile` further clamps to
  `lines.length`).
- Zero matched decls → return `[]` → `chunkBySemantic` returns `null`
  → caller falls back to `chunkByLines`.

## Error Handling

- **Pure, never throws.** Each extractor is a pure function over
  `(filePath, source)`: no file I/O, no network, no global state.
  Risky scans (delimiter balancing, indentation lookahead) are written
  defensively (bounds-checked loops, no unguarded array access — TS
  `noUncheckedIndexedAccess` forces this) so they cannot throw.
- **Defense in depth.** `chunkBySemantic` already wraps
  `extractor(path, text)` in try/catch → `null`. The extractors' own
  defensiveness means that path should never fire, but it remains the
  backstop.
- **Fallback intact.** Unsupported ext, parse failure, and zero blocks
  all collapse to the single `null` → `chunkByLines` path. No new
  branches in `chunkBySemantic`; only `extractorFor` /
  `isSupportedSource` gain language clauses.
- **Lazy-load guard stays green.** Extractors import only
  `type { ExtractedBlock }` (erased at build) and `./helpers.js`
  (`node:crypto` only). No `typescript`, no eager heavy import. The
  `no-eager-typescript.test.ts` child-process check
  (`process.moduleLoadList` typescript count === 0) is unaffected
  because nothing new is statically imported into output-filter.

## Reviewed-Safe Concerns (do not re-litigate)

These were raised in review and verified safe-by-construction. Recorded
so reviewers don't re-open them. The one real regression — a name-less
construct throwing inside the extractor — is fixed in Locked Decision 3
(conditional spread + `tokenize(name ?? "")`); it is NOT in this list.

- **(a) Overlap / out-of-range / throw spans.** `partitionFile` clamps
  every span to `[1, lastLine]`, drops spans where `endLine < startLine`,
  sorts by `startLine`, `continue`s past any span that overlaps the
  cursor (`span.startLine < cursor`), and gap-fills `cursor..lastLine`.
  Simulated over overlapping, reversed, runaway, and past-EOF span sets:
  the exhaustive-over-non-blank invariant held every time, and
  `chunkBySemantic`'s try/catch is the throw backstop.
- **(b) Eager-load.** The new extractors statically import only
  `type { ExtractedBlock }` (type-erased) + `./helpers.js` (`node:crypto`).
  They are reached ONLY through the already-lazy
  `await import("@megasaver/indexer")` in `semantic.ts`. The
  no-eager-typescript guard exercises `import("@megasaver/output-filter")`,
  which is untouched — guard stays green.
- **(c) blockType.** Mapping uses only `"function"` / `"class"` /
  `"schema"`, all valid `blockTypeSchema` literals. No invented enum value.
- **(d) endLine miscompute.** Gap-fill covers any range a span misses;
  runaway/never-closing-delimiter spans clamp to EOF, then
  oversize-subsplit (>80 lines) into line windows. No non-blank line is
  ever dropped from ranking.
- **(e) name absent.** Fixed in Locked Decision 3 (the BLOCKER) — see
  there. Listed only to cross-reference.
- **(f) Worse-than-line-chunks.** The worst valid mis-span degrades to
  the oversize line-window subsplit (== line chunks), never worse. The
  only true "no benefit" regression was the name-throw whole-file
  fallback (== line chunks, not worse), now fixed. Python's naive
  col-0/indentation END rule mis-spans on a multiline string whose
  continuation sits at column 0 (e.g. triple-quoted text), splitting a
  `def` body, but the partition stays exhaustive — acceptable per the
  explicit mis-span tolerance (Locked Decision 4). One integration test
  asserts exhaustiveness on that case (see Testing Strategy).

## Testing Strategy

TDD: write failing tests first, then implement to green.

### Per-language extractor unit tests

`packages/indexer/test/extract-py.test.ts`,
`extract-go.test.ts`, `extract-rs.test.ts` — mirror
`extract-ts.test.ts`:

- **Python:** a top-level `def` → one `"function"` block whose span
  covers the body (header line through the last indented line before
  the next col-0 decl); a top-level `class` → one `"class"` block; two
  adjacent top-level defs produce two non-overlapping blocks;
  `keywords` = `tokenize(name)`; stable `contentHash` for identical
  input.
- **Go:** a `func Foo() { ... }` → one `"function"` block ending on
  the closing-brace line; a `type Foo struct { ... }` → one
  `"schema"` block, brace-balanced END; a `var ( ... )` group →
  paren-balanced END; a single-line `type ID int` → 1-line span.
- **Rust:** `fn foo() { ... }` and `pub async fn bar() { ... }` →
  `"function"` blocks, brace-balanced END; `struct`/`enum`/`trait` →
  `"schema"`; `impl`/`mod` → `"class"`; a unit `struct Foo;` →
  1-line span.
- **All:** every block has `imports/exports/calls/calledBy === []`;
  `blockType` is a valid enum literal; `endLine >= startLine`.

### chunkBySemantic integration (per language)

Extend `packages/output-filter/test/semantic-chunk.test.ts`:

- For each of `.py` / `.go` / `.rs`: a multi-decl source →
  `chunkBySemantic` returns non-null, a chunk contains each decl
  header text, and `assertExhaustivePartition(text, chunks)` holds
  (every non-blank line covered by exactly one chunk, no overlap, no
  whitespace-only chunk).
- Unsupported ext (`.csv` etc.) → `null` (existing test, kept).
- A `.py`/`.go`/`.rs` source with zero top-level decls (e.g. only
  statements/comments) → `null` (zero blocks → fallback).
- A `.py` source with a triple-quoted string whose continuation sits
  at column 0 inside a `def` body → `assertExhaustivePartition` still
  holds. The col-0 indentation END rule mis-spans here (it ends the
  block early at the column-0 continuation line), but the partition
  stays exhaustive — this test pins the documented mis-span tolerance
  (see Reviewed-Safe Concern f).

### Lazy-load guard

`packages/output-filter/test/no-eager-typescript.test.ts` stays
unchanged and MUST remain green (typescript moduleLoadList count ===
0 after importing output-filter).

### TS config constraints honored

`strict`, `exactOptionalPropertyTypes` (so `name` is set via
conditional spread — `...(name !== undefined ? { name } : {})` —
never `name: undefined`), `noUncheckedIndexedAccess` (bounds-checked
line access), `noPropertyAccessFromIndexSignature`, ESM `.js`
specifiers, `NodeNext`.

## Risk

**HIGH (§12)** — touches the compression core chunker
(`output-filter/semantic.ts`) and the indexer extractor surface.

De-risking factors:

- **Additive:** three new files + three re-export lines + three
  dispatch clauses. No existing extractor, `partitionFile`,
  `chunkByLines`, ranking, or scoring is modified.
- **Gated:** every new path is behind `isSupportedSource` /
  `extractorFor`; unsupported and failure cases collapse to the
  existing `null` → `chunkByLines` fallback.
- **Zero-dep:** no new dependency, no wasm, no parser grammar.
- **Never-throws:** pure defensive extractors + existing try/catch
  backstop.
- **Lazy-load preserved:** no new heavy static import into
  output-filter; the eager-load guard test enforces it.

Required reviewers (HIGH): `code-reviewer` AND `critic` (separate
passes). Implement in worktree on branch
`feat/semantic-ast-py-go-rust`; never edit on `main`.

## DoD Deltas

Standard Definition of Done (§9) applies. Feature-specific:

- **Changeset required:** `@megasaver/indexer` **minor** (new
  `extractPy` / `extractGo` / `extractRs` public exports) and
  `@megasaver/output-filter` **minor** (new supported source
  extensions). Add `.changeset/<descriptor>.md`.
- **Tests first (TDD):** three extractor unit suites + per-language
  `chunkBySemantic` integration cases, written red before
  implementation.
- **Smoke evidence:** a captured `chunkBySemantic` run (or test
  output) showing a `.py`, `.go`, and `.rs` source each chunked at
  decl boundaries with an exhaustive partition.
- **`pnpm verify` green:** `biome check` (run
  `pnpm exec biome check <changed files>` before each commit),
  `tsc --noEmit`, `vitest run`, `conventions:check`. Do not break
  `apps/cli/test/readme-proxy-mode.test.ts`.
- **Reviewers:** `code-reviewer` AND `critic` passes (HIGH), author ≠
  reviewer.
- **Git:** explicit paths only (never `git add -A` / `git add .`);
  commit on `feat/semantic-ast-py-go-rust`; never switch branches.
