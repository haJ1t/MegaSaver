---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/daemon": minor
---

Add tiered memory + confidence decay to memories (M2, Letta/MemGPT-class
working/recall/archival). Deterministic, no LLM, no background timer;
additive and backward-compatible.

`MemoryEntry` (and the overlay variant + update patch) gain an optional
`tier` (`working` | `recall` | `archival`); an absent tier reads as
`recall`, so existing stores load unchanged. The centralized recall
predicate `isRecallable` is now tier-aware — it excludes `archival` by
default and includes it only with `{ includeArchival: true }` — so all
recall surfaces (BM25 + semantic search, the MCP `recall` /
`get_relevant_memories` tools, the daemon recall handler, and the GUI
connector-context builder) inherit tier filtering with no per-surface
re-implementation. `searchMemoryEntries` / `searchMemoryEntriesSemantic`
accept `includeArchival` and filter `archival` by default.

New `effectiveConfidence(memory, now)` pure helper (exported) weights a
memory's base confidence by age (30-day half-life) and tier (small
working boost); it is read-time only and never mutates stored
confidence. `searchMemoryEntries` multiplies BM25 scores by it so an
aged/low-confidence memory ranks below a recent/high one — strictly a
down-rank, never a drop. New `mega memory sweep <project>` CLI command
and `mega_memory_sweep` MCP tool apply the one deterministic, lossless
mutation: an approved, currently-valid memory that is closed/superseded,
stale, or low-confidence-and-inactive is demoted to `tier = "archival"`
(reversible, never deleted). Both report `archived=N scanned=M` (with
`--json`) and are idempotent.
