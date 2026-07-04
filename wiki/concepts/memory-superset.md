---
title: Memory Superset (WS3)
tags: [concept, memory, embeddings, graph, ws3]
sources:
  - docs/superpowers/specs/2026-06-30-memory-superset-design.md
  - concepts/structured-memory-engine.md
  - entities/retrieval.md
status: active
created: 2026-06-30
updated: 2026-06-30
---

# Memory Superset (WS3)

Deepen Mega Saver's memory into a **superset** of mem0 / Letta / Zep /
Cognee / Memori / claude-mem, built ON the existing stack ([[concepts/structured-memory-engine]]
DIMMEM + `@megasaver/memory-graph` + [[entities/retrieval]] embeddings). Additive; the
moat is kept: evidence ledger + human approval gate ([[concepts/structured-memory-engine#approval-gate]])
+ agent-agnostic shared memory + lossless local-first. Spec:
`docs/superpowers/specs/2026-06-30-memory-superset-design.md` (risk HIGH).

## Layered roadmap

1. **Semantic recall** — shipped (increment 1).
2. **Entity graph** — shipped (increment 1).
3. temporal/bi-temporal — shipped (M1, 2026-06-30).
4. tiered (working/recall/archival) + decay — shipped (M2, 2026-06-30).
5. canonicalization on approve — deferred (plugs into `approve-memory.ts`).
6. transcript → memory — deferred (LLM opt-in).

## Increment 1 (shipped 2026-06-30)

- **Semantic recall.** Per-project sidecar
  `<storeRoot>/memory/<projectId>.embeddings.jsonl` keyed by memory id
  (`embedMemoryEntries` in `packages/core/src/embed-memory.ts`),
  incremental by a `title+content` hash — opt-in, no model on import.
  `searchMemoryEntriesSemantic` (cosine) sits ALONGSIDE BM25
  `searchMemoryEntries`. `get_relevant_memories` boundary-embeds the task
  best-effort, semantic-ranks when a sidecar exists, else falls back to
  BM25. Mirrors the WS1 embed-blocks / context-pruning pattern.
- **memoryRelevance wiring.** The CLI + MCP context tools now feed the
  pruner's `memoryRelevance` factor from ALL approved non-stale memories'
  `relatedFiles` (`approvedMemoryFiles`) instead of a BM25-narrowed subset
  that silently dropped approved memories whose prose missed the task.
- **Entity layer.** `entity` node kind + `entity-mention` edge kind in
  memory-graph; deterministic (NO LLM) extraction from each memory's
  `relatedSymbols`/`relatedFiles` (`entity:symbol:` / `entity:file:`
  prefixes), enabling cross-memory "what do we know about X?" aggregation.

## M2 — tiered memory + decay (shipped 2026-06-30)

- **Tier.** Optional `tier` (`working`|`recall`|`archival`) on
  `MemoryEntry` + overlay + update patch; absent ⇒ `recall` (`tierOf`).
  Back-compat: old rows read as recall.
- **Tier rides the centralized predicate.** `isRecallable(memory, asOf,
  {includeArchival?})` excludes `archival` by default → all 4 isRecallable
  surfaces (MCP recall, get_relevant_memories, daemon recall, GUI
  connector-context) inherit it; the 2 searches add a matching
  `includeArchival` filter. No per-surface drift.
- **Decay.** `effectiveConfidence(memory, now)` pure read-time fn
  (baseWeight × 30-day-half-life ageDecay × tierWeight, working +10%),
  multiplied into BM25 scores in `searchMemoryEntries` — down-ranks aged
  memories, never drops them (always > 0).
- **Sweep = the only mutation.** `mega memory sweep` CLI +
  `mega_memory_sweep` MCP tool: deterministic, lossless, idempotent — sets
  `tier=archival` for closed/superseded, stale, or low-confidence-inactive
  (≥90d) memories via `updateMemoryEntry`. No background timer.

## CI stays model-free

Vectors are injected in tests; the real `embed()` path is gated
`it.skipIf(!process.env.MEGA_EMBED_E2E)`. A default `pnpm verify` loads no
model (verified under `TRANSFORMERS_OFFLINE=1`).

## Related

- [[concepts/structured-memory-engine]] · [[concepts/structured-memory-engine#approval-gate]]
- [[concepts/context-pruning-engine]] (consumes `memoryRelevance`)
- [[entities/retrieval]] (the WS1 embeddings substrate)
