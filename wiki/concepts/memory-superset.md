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
moat is kept: evidence ledger + human approval gate ([[concepts/memory-approval]])
+ agent-agnostic shared memory + lossless local-first. Spec:
`docs/superpowers/specs/2026-06-30-memory-superset-design.md` (risk HIGH).

## Layered roadmap

1. **Semantic recall** — shipped (increment 1).
2. **Entity graph** — shipped (increment 1).
3. temporal/bi-temporal — deferred sub-spec (plugs into `memory-entry.ts` + memory-graph `model.ts`).
4. tiered (working/recall/archival) + decay — deferred (plugs into `memory-entry.ts` + `memory-search.ts`).
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

## CI stays model-free

Vectors are injected in tests; the real `embed()` path is gated
`it.skipIf(!process.env.MEGA_EMBED_E2E)`. A default `pnpm verify` loads no
model (verified under `TRANSFORMERS_OFFLINE=1`).

## Related

- [[concepts/structured-memory-engine]] · [[concepts/memory-approval]]
- [[concepts/context-pruning-engine]] (consumes `memoryRelevance`)
- [[entities/retrieval]] (the WS1 embeddings substrate)
