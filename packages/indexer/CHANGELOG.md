# @megasaver/indexer

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
