# @megasaver/indexer

## 0.2.4

### Patch Changes

- Updated dependencies [a3ee0af]
  - @megasaver/policy@2.1.0

## 0.2.3

### Patch Changes

- 07a4e3d: Stop `balancedEnd` in the Go and Rust extractors from scanning to EOF for a
  declaration that opens and closes on its own line.

  Both copies flipped their `opened` flag from the _end-of-line_ delimiter depth,
  so a declaration whose start line nets zero — `type ID string`,
  `type Message0 = pb.Message0`, `impl Auth {}`, `pub fn f(s: &S) -> u32 { s.f }` —
  never set it and the scan ran on. Two consequences, one root cause:

  - **Wrong spans.** The scan adopted the _next_ declaration's delimiters, so the
    one-line block swallowed it (`type ID string` before a 3-line `func Foo`
    reported lines 1–4) and the swallowed declaration was never emitted at all,
    because the caller resumes at `end - 1`.
  - **O(n²).** On a file where such declarations dominate (generated Go type
    aliases, one-line Rust accessors) each of the n declarations walked the
    remaining n lines: 20,000 declarations took 29.2 s (Go) / 49.4 s (Rust);
    they now take 26.4 ms / 26.6 ms. This is on every `.go`/`.rs` read through the
    context gate and every file walked by `mega scan` / `mega index`, whose
    1,000,000-byte file cap left ample room for the blowup.

  `opened` now flips on the opening delimiter itself, so a self-closing line ends
  the block on that line while a genuinely multi-line declaration — including a
  Go signature split across lines, whose `) (*T, error) {` continuation also nets
  zero — still balances to its real closing delimiter. The explicit
  `;`-terminated guard in the Rust copy is subsumed by the same rule and is gone.

- 07a4e3d: Fix a quadratic key-line scan in `extractJson`.

  `lineOf` compiled a fresh `RegExp` per top-level key and ran a full
  `lines.findIndex` for each one, so a flat JSON dictionary cost O(keys x lines) —
  quadratic in file size. Flat dictionaries are the common case, not an exotic
  one: i18n locale files, config maps and data dumps are all one big top-level
  object.

  Both read paths reach it uncapped or near-capped. `filterOutput` routes any
  `.json` file read (`proxy_read_file`, `mega output read`) through
  `chunkBySemantic` -> `extractJson`, and `readRaw` applies no size cap;
  `mega scan` / `mega index` hit it for every `.json` up to the 1 MB
  `DEFAULT_MAX_FILE_SIZE`. Measured through `extractJson` on a realistic locale
  shape: 33 ms at 97 KB, 121 ms at 196 KB, 479 ms at 395 KB, 3409 ms at 1061 KB
  (~3.5x per doubling). A same-byte-size, same-line-count nested control with one
  top-level key cost 5.5 ms at 1061 KB — the cost tracked key count, not size.

  Fixed by resolving every key in one pass: a single anchored regex per line
  records the first line each key token appears on, and `lineOf` becomes a map
  lookup. 7.3 ms at 1061 KB (467x).

  Semantics are unchanged, including first-occurrence-wins (a nested key on an
  earlier line still beats the top-level key of the same name) and the fallback to
  line 1 for keys whose source form is escaped (`"a\"b"`, `"é"`), which the
  per-key regex never matched either. Verified by differential comparison of the
  old and new resolvers over 40,240 documents — every `.json` tracked in the repo
  in both pretty and minified form, 18 adversarial shapes (regex metacharacters in
  keys, escaped quotes, trailing backslashes, tab indentation, duplicate keys,
  key-like text inside string values), and 20k randomised documents over a hostile
  alphabet — 42,068 key lookups, zero divergences.

  Guarded by `test/extract-json-quadratic.test.ts`, which drives the exported
  function on a 1 MB flat locale file (the shipped scan cap) and compares it to
  the same object minified — same keys, same values, so every per-key cost that is
  not the defect cancels and only line count differs. One-pass measures 1.10-1.43x
  across 192 KB-1 MB; with the fix reverted, 20.5-79.0x. A wall-clock ceiling was
  tried first and rejected: the one-pass call is 24 ms idle but 1137 ms inside a
  full parallel `pnpm verify`, which leaves no gap below the defect.

- 1ecbaef: Stop the markdown heading regex from backtracking on a line it cannot match.

  `HEADING_RE` paired `\s+` with a `(.+?)` capture. Both can match a space, so a
  heading-shaped line that ultimately fails made the engine try every
  (whitespace-run x capture) split before giving up. Measured through `extractMd`
  on `"#" + " "*W + "x"*W + "\r y"`, doubling W: the lazy form was **cubic**
  (1.2 s / 8.4 s / 67 s at W=2k/4k/8k) and an intermediate `\s+(.+)\r?$` form was
  still **quadratic** (1,575 ms at W=32k). This is on every `.md` file walked by
  `mega scan` / `mega index`, whose 1,000,000-byte cap left ample room.

  The pattern is now `/^(#{1,6})\s/` — `#{1,6}` is bounded and `\s` matches exactly
  one character, so there is no unbounded quantifier and no backtracking is
  possible. The name is taken by slicing and `trim()` rather than by a second
  quantifier. Same input now costs **0.02 ms at W=32k**.

  Two behavioural notes. Interior `\r`/U+2028/U+2029 was rejected before only as a
  side effect of `.` excluding line terminators; slicing has no such side effect, so
  the rejection is now explicit. And a hash line that is only whitespace (`"#  "`)
  is no longer a heading: the old regex accepted it with the name `" "` purely
  because `\s+` had to surrender one character, while already rejecting `"# "`.
  One rule — a heading needs a non-whitespace name — replaces a rule plus an
  exception. The change is one-way and can only drop a nameless heading, never
  invent one.

- Updated dependencies [193e757]
- Updated dependencies [ab4d04c]
- Updated dependencies [07a4e3d]
- Updated dependencies [20bf90d]
- Updated dependencies [25b23b8]
- Updated dependencies [d270c93]
- Updated dependencies [07a4e3d]
- Updated dependencies [ddd86a7]
- Updated dependencies [0ad461a]
- Updated dependencies [ad32371]
  - @megasaver/policy@2.0.0
  - @megasaver/shared@1.3.1
  - @megasaver/retrieval@1.0.4

## 0.2.2

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0
  - @megasaver/policy@1.2.2
  - @megasaver/retrieval@1.0.3

## 0.2.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0
  - @megasaver/policy@1.2.1
  - @megasaver/retrieval@1.0.2

## 0.2.0

### Minor Changes

- a3306ec: WS2: precise cross-file call resolution for TS/JS via import bindings.
  The indexer now resolves each TS/JS call to a fully-qualified name
  (`<module>#<name>`) using the calling file's import bindings (named,
  aliased, default, namespace; relative specifiers → repo file path, bare
  npm specifiers kept as-is) and writes additive optional `resolvedCalls`
  / `resolvedCalledBy` FQN edges on each `CodeBlock`. Two same-named
  functions in different files now get distinct FQNs, so `mega_impact`'s
  reverse closure and the context-pruner dependency closure no longer
  include false cross-file callers. The existing name-based `calls` /
  `calledBy` are unchanged; `selectImpact` and `selectPack` prefer the
  resolved edges when present and fall back to name-based otherwise
  (py/go/rust and old indexes keep working). Light import-binding pass
  only — no `ts.Program` type-checker; re-exports, barrels, dynamic
  import and tsconfig path aliases are deferred to the full-LSP phase.
- fde8e86: Add the live-first Phase 3 workspace-keyed read surface.

  - `@megasaver/shared`: `workspaceKeySchema`, `encodeWorkspaceKey(cwd)`
    (`sha256(cwd)` → 16 lowercase-hex chars), and `workspaceLabel(cwd)` —
    an fs-safe key space distinct from the lowercase-UUID `projectId`.
  - `@megasaver/indexer`: `resolveWorkspaceIndexPaths(storeDir, key)` and
    `buildWorkspaceIndex(...)` write under `index/<workspaceKey>/`, plus
    `workspaceProjectId(key)` (a deterministic UUIDv5 stamped on index
    blocks so `codeBlockSchema` parses without a schema migration).
  - `@megasaver/core`: `readWorkspaceRules` / `readWorkspaceTools` read the
    workspace-keyed overlay JSONL (`rules/<key>.jsonl`, `tools/<key>.jsonl`),
    reusing the existing rule/tool zod schemas. Read-only; no registry.

- f7cbc28: Phase 2 (Semantic Repo Index): new `@megasaver/indexer` package that
  parses a repo into typed `CodeBlock`s — AST extraction for TS/JS/TSX via
  the TypeScript compiler API, structural extraction for Markdown (heading
  sections) and JSON (top-level keys + package.json `script:<name>`), an
  ignore-aware traversal-safe `scanRepo` (never follows symlinks; honors
  always-ignore + .gitignore + .megaignore; skips secret/binary/oversized
  files), an atomic JSON-directory store with `contentHash` incremental
  `buildIndex`, and BM25 `searchBlocks`. New `CodeBlockId` in
  `@megasaver/shared`. CLI gains `mega scan` and `mega index
build/status/search/show`. `typescript` is a CLI runtime dependency
  (externalized from the bundle).
- 5431672: Extend semantic AST chunking to Python (.py), Go (.go), and Rust (.rs)
  source reads. Three zero-dependency heuristic extractors (extractPy /
  extractGo / extractRs) detect top-level declarations (def/class; func/
  type/var(/const(; fn/struct/enum/trait/mod/impl) by line scanning and
  indentation- or brace-balanced spans — no tree-sitter, wasm, or other
  parser dependency. The chunker now produces AST-aligned chunks for those
  files instead of fixed line windows; unsupported extensions, parse
  failures, and zero-decl files fall back to line chunking as before. The
  extractors stay off output-filter's eager import graph (loaded lazily via
  @megasaver/indexer), so no per-tool-call start pays a heavier import.
- 14868ee: WS1 hybrid BM25 + embeddings retrieval, additive over BM25 with graceful
  BM25-only fallback when vectors/model are absent.

  - indexer: `buildIndex`/`buildWorkspaceIndex` gain an opt-in `embeddings?`
    flag (default false) and now return `Promise<BuildResult>`; when true they
    write an `embeddings.jsonl` sidecar next to `blocks.jsonl`, carrying
    unchanged-block vectors forward via the incremental contentHash skip.
    `searchBlocks` accepts optional pre-computed `{ taskVector, blockVectors }`
    and cosine-reranks the BM25 hits when present.
  - context-pruner: `scoreBlocks` stays synchronous and gains an
    `embeddingRelevance` factor consuming pre-computed `taskVector` /
    `blockVectors` (0 when absent); new `embedding` weight; the factor is added
    to `scoreFactorsSchema`.
  - mcp-bridge: the context-pruning tool best-effort loads the sidecar and
    embeds the task at the boundary, passing vectors into the pack; its handlers
    are now async. Default builds download no model — the embed path is opt-in
    and gated.

### Patch Changes

- Updated dependencies [7fcd881]
- Updated dependencies [09912d9]
- Updated dependencies [0a3256b]
- Updated dependencies [b2e39cd]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/embeddings@0.2.0
  - @megasaver/policy@1.2.0
  - @megasaver/retrieval@1.0.1
