---
feature: context-drop-inspector
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer]
build-order: "3 of 9 (wave-3 batch)"
---

# Context Drop Inspector (P0-3)

## Problem

The pruner (`@megasaver/context-pruner`, 8-factor scoring `wiki/concepts/context-pruning-engine.md`) and the context gate (`@megasaver/context-gate`, redact→chunk→rank→fit `wiki/concepts/context-gate-pipeline.md`) both drop content, but neither explains what was dropped and why. The user sees a smaller context and must trust it. When a retrieval regression lands ("my memory stopped being recalled"), there is no deterministic way to prove which memory was evicted by which scorer or whether the gate's `modeToBudget` clamp was the culprit. Existing `why` surfaces (`context-pruner` block scores, gate `rank`) are per-call logs, not a joined inspector.

## Goal

1. `mega context why <query> [--session <id>] [--budget <tokens>]` runs a **deterministic replay**: take the current retrieval set (BM25 + indexer + memory-recall), score with the same 8-factor scorer and the same gate `modeToBudget`, and emit a **drop report** — kept vs. dropped blocks, per-factor scores, `reason:{budget|rank|policy|dedup|stale}`, and the `chunkSetId` to restore.
2. `mega context why --last` replays the last real pack (from `stats/audit` or `content-store` chunk-set inventory) so the user can inspect what the agent actually saw.
3. A one-screen summary is also printed by `mega context why` on every normal `mega context pack` run when `--explain` is passed (opt-in).

Success criteria: same query + same index + same budget → identical drop report (deterministic); dropped blocks carry exact `chunkSetId` + `blockId` for `mega output chunk` restore; no network, no LLM, no new storage.

## Non-Goals (YAGNI)

- No LLM "explanation" of why the pruner chose X (scores are the explanation).
- No mutation of index, memory, or policy — read-only replay.
- No persistent audit of every pack (that is P1-1 evidence-bundle); inspector is on-demand replay, optionally seeded from the last pack's recorded block ids.
- No GUI in v1 (CLI text + JSON; P2-1 heatmap may later plot the same counters).

## Locked Decisions

1. **Replay, not log scrape.** Inspector re-executes the same pure functions the production path uses: `packages/retrieval/src/bm25.ts`, `packages/context-pruner/src/scorer.ts` (8 factors), `packages/context-gate/src/rank.ts` + `packages/context-gate/src/fit.ts`. Inputs are captured from disk: file index (`packages/indexer` sidecar `index/meta.json`), memory sidecar (`packages/long-memory` embeddings ledger), and policy fence set. This guarantees the report matches what the real pack did, even without a prior log.
2. **Budget is the contract.** Token budget comes from `@megasaver/shared` `modeToBudget` (same constant the gate uses). CLI `--budget` overrides the mode for "what-if" analysis. Token counting uses `@megasaver/output-filter` `estimateTokens` (same as gate). No second budget source.
3. **Deterministic ordering.** Tie-breakers are pinned: score desc → `blockId` lexicographic → `filePath` lexicographic. RNG, if any scorer uses it, is not consulted; inspector rejects packs whose scorer config contains non-deterministic flags (fails closed with `error: non-deterministic scorer`).
4. **Report schema (Zod strict).** `DropReport = { version:1, query:string, budget:number, kept: KeptBlock[], dropped: DroppedBlock[], counters:{totalBlocks, totalTokens, keptTokens, droppedTokens, budgetUtilization}, scorerConfigHash }` where `KeptBlock = {blockId, filePath, score, factors:{f1..f8}, rank, chunkSetId}` and `DroppedBlock = KeptBlock & {reason: "budget"|"rank"|"policy"|"dedup"|"stale", droppedAtRank:number}`. Every path is redacted once via `redact()` at render time.
5. **Restore pointer is the chunk-set id.** Dropped blocks that originated from a chunk-set carry `chunkSetId`; inline blocks carry `blockId` + `filePath` + line range. Inspector prints `mega output chunk "<chunkSetId>" "0"` for the former, matching `wiki/concepts/diff-on-reread.md` recovery wording.
6. **Last-pack seeding.** `stats/audit` (`packages/stats/src/audit.ts`) and `content-store` listing provide the last pack's `blockIds` when `--last` is used; inspector joins them to the current index to show "which of the kept blocks came from the last real pack" (a `provenance: "last-pack" | "replay"` flag). If audit is absent, inspector falls back to pure replay and labels provenance `replay`.
7. **Ownership.** `@megasaver/context-pruner` + `@megasaver/context-gate` remain the scoring/ranking owners; this feature adds a thin `packages/context-pruner/src/inspect.ts` (`inspectPack`) pure function and a CLI wrapper `apps/cli/src/context/inspect.ts`. No new storage.

## Architecture

```
mega context why "fix auth" [--budget 2000] [--session <id>]
  resolveStore + load index meta + load memory sidecar + load policy fence
  retrieval.search(query) -> candidates (BM25 + block ids)
  pruner.scorer.scoreAll(candidates) -> scored[]
  gate.rank(scored) -> ranked[]
  gate.fit(ranked, budget) -> {kept, dropped}
  build DropReport (hash scorer config, count tokens)
  renderDropReport(report) -> text (default) | --json
```

## Components

- **C1 `packages/context-pruner/src/inspect.ts` (pure):** `inspectPack(input:{query, candidates, scored, ranked, kept, dropped, budget, scorerConfig}): DropReport` — deterministic, no I/O.
- **C2 `apps/cli/src/context/inspect.ts`:** `runContextWhy` io-injected entry; loads index/policy, calls retrieval + scorer + rank/fit via existing re-exports, builds report.
- **C3 `apps/cli/src/commands/context/why.ts`:** citty command `mega context why` (query positional, flags `budget`/`session`/`last`/`json`/`explain`).
- **C4 `apps/cli/src/main.ts`:** registers `context why` under existing `context` command.

## Error handling

- No index (never ran `mega index`) → `error: no index found; run mega index` exit 1 (same as `context-pack`).
- Unknown session id → `error: session "<id>" not found` exit 1.
- Budget non-numeric / ≤0 → `error: invalid budget` exit 1.
- Non-deterministic scorer config → `error: scorer is non-deterministic (seeded sampling enabled)` exit 1.
- Audit absent for `--last` → warning `no last pack found, falling back to replay` on stderr, still succeeds (provenance = replay).
- All file reads wrapped fail-open with labeled omissions in the report (never throw).

## Security & privacy

- No secrets read: only block ids, file paths (redacted), and scores. File contents are not printed in the drop report unless `--show-content` (does not exist in v1) — paths only.
- Redaction applied to every path at render time (`@megasaver/policy`).
- No network, no daemon.

## Testing

- **Unit (TDD):** `inspectPack` deterministic (same input → same dropped order/hash), budget reason (over-budget → dropped with `reason:budget`), policy reason (fenced path → `policy`), dedup (same blockId twice → second `dedup`), token counters sum correctly, config hash stability.
- **Integration:** tmp repo `mega index` + `mega context pack "query" --json` → `mega context why "query" --budget <same>` kept/dropped matches the real pack's `blockIds`; `--last` with audit seeded shows `provenance:last-pack`.
- **Regression:** existing `context-pruner` scorer + gate fit tests still pass.

## Risk & process

**MEDIUM** (§12: read-only replay over shipped scorer/gate, but touches the retrieval/budget contract). Worktree optional per MEDIUM, but HIGH-style branch recommended due to 8-factor scorer coupling. Reviewer `code-reviewer` only; `architect` pass advised.

## Dependencies / build order

- Depends on shipped: `@megasaver/context-pruner` (scorer), `@megasaver/context-gate` (rank/fit), `@megasaver/indexer` (block index), `@megasaver/retrieval` (BM25), `modeToBudget`.
- Independent of P0-1/P0-2, but strongest when preflight snapshots exist (diff can reference the inspector's `chunkSetId`).
- Build order **3 of 9 (wave-3 batch)** — after preflight, before evidence-bundle (bundle may embed the inspector's `scorerConfigHash`).

## Open questions

1. Should `--explain` be default on `mega context pack`, or opt-in? (v1 opt-in to avoid noise.)
2. Do we surface per-factor contribution bars (e.g., `recency:0.8 × 1.2`) or just final score + reason code? (v1: score + reason code + top-3 factor tags.)
