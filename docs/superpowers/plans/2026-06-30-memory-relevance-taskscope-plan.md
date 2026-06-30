---
topic: memory-relevance-taskscope
status: in-progress
risk: MEDIUM
parent-spec: docs/superpowers/specs/2026-06-30-memory-superset-design.md (§1B follow-up)
date: 2026-06-30
---

# Plan — Task-scope the `memoryRelevance` signal (M5)

Closes the §1B "Known imprecision (v1, accepted)" follow-up: feeding ALL
approved memory's `relatedFiles` to `memoryRelevance` bumps every memory-touched
file on every task. Scope it to memories RELEVANT to the task when a memory
embedding sidecar + a task vector are available; fall back to the all-approved
set otherwise. Additive, best-effort, recall-safe, CI model-free.

## Steps

1. Core pure helper `taskRelevantMemoryFiles(memories, opts)` →
   verify: injected-vector unit test, near memory's file included, far memory's
   file excluded, topK respected, only approved+current+non-stale counted.
2. Core best-effort orchestrator `taskScopedMemoryFiles(opts)` (loads sidecar via
   readVectors, uses injected taskVector or embeds task, calls the pure helper;
   returns null on no-sidecar/empty/failure) → verify: unit test returns scoped
   set with sidecar+injected vector, null with no sidecar, null/no-throw on
   embed failure.
3. MCP boundary (context-pruning.ts): reuse the task vector embeddingSignalFor
   already computes; `memoryFiles = (await taskScopedMemoryFiles(...)) ??
   approvedMemoryFiles(memories)` → verify: context-tools test, task-irrelevant
   memory's file NOT boosted with sidecar; identical-to-today with no sidecar.
4. CLI boundary (shared.ts): best-effort embed via core; same fallback → verify:
   CLI fallback identical-to-today (no sidecar in test repo).
5. Changeset (minor), spec §1B follow-up marked DONE, wiki/log.md entry.

## Verify
- Per-package: core, mcp-bridge, cli, context-pruner.
- Full `pnpm verify` (turbo build — daemon resolves core from dist).
- Model-free (injected vectors; real-embed E2E gated).
