# @megasaver/context-pruner

## 0.2.2

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0
  - @megasaver/indexer@0.2.2
  - @megasaver/retrieval@1.0.3

## 0.2.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0
  - @megasaver/indexer@0.2.1
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
- f10c761: Add a deterministic git-history co-change factor to the LAMR context pruner.
  `parseNumstat` turns raw `git log --numstat` text into a per-file co-change map
  plus churn; `coChangeStrength` scores how strongly a block's file co-evolves
  with the edit-site (`changedFiles`) set, normalized 0..1. Wired into
  `scoreBlocks` / `finalScore` as a new `coChangeRelevance` factor with weight
  `coChange: 0.5`, surfacing the migration / fixture / config that always changes
  with the edit site but is invisible to call/import edges. No LLM, no I/O in the
  scored core; absent/empty history is a no-op (factor is 0, ranking unchanged).

  The factor is now live end-to-end. New `readCoChangeLog(cwd)` export shells out
  `git log --numstat` once per repo (memoized, `""` on any failure) and is wired
  into the MCP `packFor` and CLI `loadPack` paths, so a co-changing migration /
  fixture / config actually reranks in production, not just in `scoreBlocks`.

- a0e05f7: Phase 3 (Context Pruning / LAMR): new `@megasaver/context-pruner`
  package — task-aware selection that scores the Phase 2 `CodeBlock` index
  with an 8-factor model (semantic BM25, userMention, testFailure,
  recentEdit, memory, dependency; stale/noise penalties), selects a
  6–8-block context pack under a token budget with dependency closure
  (never silently dropping a named/failing-test block), and emits per-block
  reasons + a savings audit. CLI gains `mega context
build/explain/audit/export`; the MCP bridge gains `get_relevant_context`,
  `get_relevant_code_blocks`, `explain_context_selection`, and
  `get_context_budget_report`. Memory relevance is passed in as data
  (no `@megasaver/core` edge); leaf package depends only on indexer +
  retrieval + shared.
- 3290664: Add reverse call-graph blast-radius selection (`buildImpactPack` /
  `selectImpact`) and expose it as the `mega_impact` MCP tool. Given an edited
  symbol, the reverse BFS over `calledBy` returns the symbol plus every
  transitive caller affected by changing it, under the existing context-pruner
  token budget + reasons machinery. The closure is exhaustive within budget — a
  caller cut by budget is reported in `excluded`, never silently dropped — and an
  unknown symbol yields an empty pack. Tool-resident, so it works over MCP on
  Claude Desktop.
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
- Updated dependencies [a3306ec]
- Updated dependencies [09912d9]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [5431672]
- Updated dependencies [14868ee]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/indexer@0.2.0
  - @megasaver/embeddings@0.2.0
  - @megasaver/retrieval@1.0.1
