# @megasaver/context-pruner

## 0.3.0

### Minor Changes

- 608eeba: Wave-3 P0-1/P0-2 + 7 pure cores: preflight snapshot/diff (reserved sibling, git capture, realpath-normalized), sweep scan/quarantine/restore (rank buckets, rename/copy never delete), inspectPack, hotspots scorer, prompt diet heuristics, fork model, bundle schema, deja-vu BM25, audition honest counters. CLI wired for all 9, pure TDD for 7 cores, smoke verified.

### Patch Changes

- 07a4e3d: Skip co-change pairing for mass-touch commits in `parseNumstat`.

  Pairing is all-pairs within a commit — O(files²) in time AND memory — and
  nothing capped commit width ahead of it. One wide commit inside the
  1000-commit `readCoChangeLog` window (initial import, vendored deps drop,
  repo-wide formatter run, generated client) dominated the whole parse, and every
  `mega context pack` / MCP context-pruning call pays it on the first pack build
  in a process (`score.ts`'s memo only avoids re-paying it within one process).

  Measured on `parseNumstat` with one commit of N files, node v25.8.2: 1000 files
  (25 KB) 75 ms / 142 MB RSS, 2000 files (51 KB) 344 ms / 370 MB, 4000 files
  (103 KB) **2256 ms / 960 MB** — 4-6.5x per doubling while the input bytes only
  double, so ~8-10k files in one commit is OOM, not just slow. After the cap the
  same 4000-file commit parses in **1 ms / 74 MB**.

  A commit touching more than 50 files carries no co-change signal anyway —
  "everything changed with everything" is noise, and it inflates `peak`, the
  normalizer for every other pair. Its rows still contribute churn; only its
  pairs are skipped. On this repo's own 874-commit history the cap drops 18
  commits (2%) and 57% of the pair entries, leaving the strongest pairs and their
  normalized strengths intact (top-10 identical, e.g. 1.00, 0.43 -> 0.41,
  0.32 -> 0.31).

- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [1ecbaef]
- Updated dependencies [ad32371]
  - @megasaver/indexer@0.2.3
  - @megasaver/shared@1.3.1
  - @megasaver/retrieval@1.0.4

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
