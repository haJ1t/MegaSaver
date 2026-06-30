---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

M5 task-scope the `memoryRelevance` signal in the context pruner. Closes the
WS3-inc1 §1B "Known imprecision (v1, accepted)" follow-up: both context-pruning
boundaries fed ALL approved memory's `relatedFiles` to `memoryRelevance`,
boosting every memory-touched file on every task regardless of task relevance.

New pure core helper `taskRelevantMemoryFiles(memories, { taskVector,
memoryVectors, topK })` ranks approved, non-stale memories by
cosine(taskVector, memoryVector), keeps the top-K above a small floor, and returns
the deduped union of THEIR `relatedFiles` (the narrowed counterpart of
`approvedMemoryFiles`). Eligibility mirrors `approvedMemoryFiles` EXACTLY
(`approval === "approved" && !stale`, no validity/tier gating) so the scoped set
is always a task-filtered subset of the fallback — the signal never flips on
whether a sidecar exists. A best-effort orchestrator `taskScopedMemoryFiles` loads
the project's memory-vector sidecar, reuses the task vector the pruner already
computes for the code-block signal (MCP) or embeds the task itself (CLI), and
returns null on no/empty sidecar, no task vector, or any failure.

Both boundaries (`mcp-bridge` context-pruning.ts + `cli` context/shared.ts) now
use `taskScopedMemoryFiles(...) ?? approvedMemoryFiles(memories)`: task-scoped
when embeddings are available, falling back to all-approved otherwise. Additive,
best-effort (never throws), recall-safe (no-sidecar behavior is byte-identical to
today), deterministic, CI model-free (injected vectors in tests; real `embed()`
E2E-gated). `staleMemoryFiles` is unchanged.
