---
title: Phase 3 — Context Pruning Engine (LAMR) — design
risk: HIGH
status: draft
created: 2026-06-11
updated: 2026-06-11
related:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-11-phase2-semantic-repo-index-design.md
  - docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md
  - wiki/concepts/context-pruning-engine.md
  - wiki/concepts/context-gate-pipeline.md
  - wiki/syntheses/contextops-roadmap.md
---

# Phase 3 — Context Pruning Engine (LAMR) — design

## §0 TL;DR

Add task-aware context selection: given a free-text task, score the
Phase 2 `CodeBlock` index with a multi-factor relevance model and
return a **context pack** of 6–8 blocks, each with a reason and score,
plus an explicit excluded list. New `@megasaver/context-pruner` package
+ `mega context build --task / explain / audit / export`. Depends on
Phase 2 (blocks to score) and reads Phase 1 (memory relevance).

This is the **repo-and-task** cousin of the shipped, output-centric
wiki/concepts/context-gate-pipeline.md; it does not replace it.

## §1 Motivation

The headline product claim — "fix the login bug" → 6 blocks instead of
40 files, ~72% fewer context tokens — lives here. The Context Gate
pipeline compresses one tool's stdout; it does not answer "what should
the agent read for *this task*." Verified gap
(wiki/syntheses/contextops-roadmap.md Phase 3): no task-aware scoring,
no `mega context` command, no block+reason output.

## §2 Non-goals

- **No embeddings.** `semanticRelevance` is BM25 + keyword/path
  overlap, not vectors (consistent with Phases 1–2).
- **No file mutation, no agent invocation.** Pruner selects and
  explains; it does not edit or call an LLM.
- **No replacement of the Context Gate output pipeline.** Different
  input (repo blocks vs tool stdout), different package.
- **No live edit/test signals in v1** beyond what is passed in
  (`--changed-files`, `--failing-tests`); a git/test watcher is later.

## §3 Scoring model (`packages/context-pruner/src/score.ts`)

```
finalScore =
    w_sem  * semanticRelevance       // BM25(task terms, block doc)
  + w_dep  * dependencyRelevance     // block imported/called by a high-semantic block
  + w_test * testFailureRelevance    // block is/(covers) a failing test (from --failing-tests)
  + w_edit * recentEditRelevance     // block.lastModifiedAt recency / in --changed-files
  + w_mem  * memoryRelevance         // a high-relevance memory cites block.filePath
  + w_user * userMentionRelevance    // task text names the file/symbol explicitly
  - w_stale * stalePenalty           // block in a file marked stale / memory.stale
  - w_noise * noisePenalty           // generated/vendored/lockfile/very-large
```

Weights are named constants (tunable, documented defaults), not magic
numbers. Each contributing factor is recorded per block so `explain`
can show *why*. `userMentionRelevance` and `testFailureRelevance` are
near-decisive (an explicitly named file or a failing test almost always
belongs in the pack).

## §4 Two-dimensional selection

Per wiki/concepts/context-pruning-engine.md, scoring fuses:

1. **Semantic evidence** (`semanticRelevance`, `userMentionRelevance`,
   `testFailureRelevance`, `memoryRelevance`).
2. **Dependency support** (`dependencyRelevance`) — after the top
   semantic blocks are chosen, pull their `imports`/`calls` (Phase 2
   metadata) so the pack is self-contained even when a helper isn't
   directly task-relevant.

Selection: rank by `finalScore`, take the top N (default 8) under a
budget (`--max-tokens`). **Note:** no token estimator exists in the
codebase today — Phase 3 reuses output-filter's byte-budget logic
(`fitBudget`/`effectiveBudget`) and adds a simple token estimate
(`chars/4` heuristic) over it; a precise tokenizer is a later upgrade.
Then ensure dependency closure of the chosen set up to the budget.
Anything cut for budget is reported as excluded-by-budget vs
excluded-by-irrelevance.

## §5 Context pack output

```
type ContextPack = {
  task: string;
  included: ScoredBlock[];   // {blockId, file, startLine, endLine,
                             //  score, reasons: string[], factors}
  excluded: ScoredBlock[];   // same shape; reason = top exclusion cause
  budget: { maxTokens, usedTokens, blocksConsidered };
}
```

`reasons` are human strings derived from the dominant factors
("direct semantic evidence", "dependency support", "failing test
evidence", "named in task", "cited by auth decision memory"), matching
the roadmap's example output.

## §6 CLI surface (`apps/cli/src/commands/context/`)

- `mega context build <project> --task "<text>"` —
  `--max-tokens`, repeatable `--changed-file`, repeatable
  `--failing-test`, `--limit`, `--json`. Prints the included/excluded
  lists with scores + reasons (the roadmap's example layout).
- `mega context explain <project> --task "<text>"` — per-block factor
  breakdown (which weight contributed what).
- `mega context audit <project> --task "<text>"` — the savings view:
  filesConsidered/Included/Excluded, blocksConsidered/Included/
  Excluded, estimated tokens before (whole files) vs after (pack),
  percentage saved. Feeds Phase 8.
- `mega context export <project> --task "<text>" --format markdown` —
  the pack as a markdown context document (for paste / connector use).

## §7 MCP tools

Adds (post-AA1 surface extension, flagged per CLAUDE.md §4 process
discipline — the 4-tool surface is otherwise locked by AA1):

- `get_relevant_context(projectId, task)` → `ContextPack`.
- `explain_context_selection(projectId, task)` → factor breakdown.
- `get_context_budget_report(projectId, task)` → the audit numbers.
- `get_relevant_code_blocks(projectId, task)` (the Phase 4 roadmap
  tool) is the thin `included[]` projection of `get_relevant_context`.

## §8 Reconciliation

Builds on Phase 2 (`CodeBlock` + `imports`/`calls`/`lastModifiedAt`),
Phase 1 (`searchMemoryEntries` for `memoryRelevance`), and reuses
`@megasaver/retrieval` (`rankBm25`, `deriveIntent` to turn the task
into query terms) and output-filter's byte-budget logic
(`fitBudget`/`effectiveBudget`) for the fit step. The Context Gate's
`output-filter` rank features are a **precedent** for "score then fit
under budget" but the feature set is not reused directly (different
features, different input). Keep `@megasaver/context-pruner` separate
from `@megasaver/context-gate`.

## §9 Risk

**HIGH** — "context packer / evidence-preserving compression"
(CLAUDE.md §12 named example). The danger is **dropping a block the
agent needed** (wrong exclusion) — dependency closure (§4) and the
near-decisive user-mention/test factors mitigate this. Mandatory: full
chain + `architect` + `critic` + worktree; evidence-preserving only, no
aggressive compression. The pack must never silently drop a named file
or a failing-test block; if budget forces it, that is reported, not
hidden (CLAUDE.md anti-pattern: no silent caps).

## §10 Testing

- Scoring: each factor isolated (a block that only matches via
  user-mention still ranks; a noisy lockfile is penalized below
  threshold); weights documented and asserted.
- Dependency closure: a high-semantic block pulls in its imported
  helper even when the helper's own semantic score is low.
- Budget: blocks cut for budget are labeled excluded-by-budget; named
  files / failing-test blocks are never dropped silently (assert error
  or forced-include).
- Determinism: same task + same index → same pack (stable tie-break by
  blockId).
- CLI: build/explain/audit/export shapes + `--json`; example-output
  layout matches the roadmap.
- MCP: `get_relevant_context` / `get_relevant_code_blocks` e2e.

## §11 Decisions / open questions

1. **Separate package** (`@megasaver/context-pruner`) vs folding into
   `context-gate` → separate (different input/concern; CLAUDE.md §8 one
   bounded context per package).
2. **Edit/test signals** → passed in via flags in v1 (`--changed-file`,
   `--failing-test`); auto-detection from git/test runs is a follow-up.
3. **Default N / budget** → N=8, budget from `--max-tokens` (no hard
   default; if unset, N governs). Reviewer tunes.
4. Open: should `memoryRelevance` also boost when a `failed_attempt`
   memory cites the block? Recommend yes — ties Phase 5 warnings into
   the pack.

## §12 Out of scope

- Embeddings / vector similarity.
- Auto git-diff / test-runner integration (flags only in v1).
- LLM-based summarization of blocks (Phase 2 `summary` is structural).
- Replacing the output-pipeline Context Gate.
- The Phase 8 dashboard UI (this phase only emits the audit numbers).
