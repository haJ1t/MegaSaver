---
title: "@megasaver/context-pruner"
tags: [entity, package, context, lamr, phase-3]
sources:
  - concepts/context-pruning-engine.md
  - docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md
status: active
created: 2026-06-11
updated: 2026-06-29
---

# @megasaver/context-pruner

Phase 3 package. Task-aware selection (LAMR): scores the Phase 2
`CodeBlock` index against a task and returns a `ContextPack`. Leaf
package — depends only on `@megasaver/indexer`, `@megasaver/retrieval`,
`@megasaver/shared`, `zod`. **No `@megasaver/core` edge** (memory
relevance is passed in as `memoryFiles`/`staleFiles` data).

## Public surface

- `scoreBlocks(input)` — 9 factors per block: `semanticRelevance`
  (BM25, normalized 0..1), `userMentionRelevance` (near-decisive),
  `testFailureRelevance` / `recentEditRelevance` / `memoryRelevance`
  (from passed-in file sets), `coChangeRelevance` (git-history
  co-change, `coChange: 0.5`), `stalePenalty` / `noisePenalty`
  (lockfiles, generated, huge spans). `dependencyRelevance` is set by
  selection. `finalScore` is the weighted sum (named `WEIGHTS`).
- Co-change signal (`cochange.ts`): `parseNumstat(raw git log --numstat)`
  → per-file co-change map + churn + global peak; `coChangeStrength`
  scores a file's co-evolution with the `changedFiles` edit site,
  normalized 0..1 by the global peak. Deterministic, no-LLM, no-I/O
  (caller injects the raw text via `ScoreInput.coChangeLog`, memoized
  per process). No-op on empty/absent history — factor 0, ranking
  unchanged. Surfaces the migration/fixture/config that always changes
  with the edit site but is invisible to call/import edges.
  (source: docs/superpowers/specs/2026-06-29-context-pruner-cochange-signal-design.md)
- `selectPack(candidates, {limit, maxTokens})` — force-include
  named/failing blocks (the **safety invariant**: never silently
  dropped; a budget overflow is reported via `usedTokens`), fill to
  limit by score under a token budget, then dependency closure over
  `calls`. Excluded blocks labeled `irrelevant` vs `budget`.
- `buildContextPack(request)` — orchestrates score → select → assemble
  with per-block reasons. `auditPack(pack)` — files/blocks
  considered-vs-included + tokensBefore/after/percentSaved (feeds
  Phase 8).

Token cost is a **line-span estimate** (`~12 tokens/line`) — blocks
carry no source text, so the spec's `chars/4` is unavailable; a precise
tokenizer is a later upgrade. Budget logic is token-greedy (not the
byte-chunk `fitBudget`, which is output-pipeline-specific).

## CLI + MCP

`mega context build/explain/audit/export` (build reads the project's
index + relevant memories). MCP tools: `get_relevant_context`,
`get_relevant_code_blocks`, `explain_context_selection`,
`get_context_budget_report` (closed enum 7→11).

## Reconciliation

Status: **shipped** (PR pending). Concept: [[concepts/context-pruning-engine]].
Consumes [[entities/indexer]] blocks; the repo-and-task cousin of the
output-side [[concepts/context-gate-pipeline]]. Demo: "fix the login
bug" → 5 blocks → 2 included, ~60% token saving.
