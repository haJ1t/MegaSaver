---
topic: memory-tiered-decay
status: approved
risk: HIGH
date: 2026-06-30
spec: docs/superpowers/specs/2026-06-30-memory-superset-design.md (sub-spec 4)
---

# Memory Tiered + Decay (M2) — Plan

Built on M1 (bi-temporal + centralized `isRecallable`). Deterministic,
no LLM, no background timer. Additive + backward-compatible. Strict TDD.

## Steps

1. **Schema (`packages/core/src/memory-entry.ts`)** → verify: core vitest.
   - `memoryTierSchema = z.enum(["working", "recall", "archival"])`.
   - Add optional `tier` to `memoryEntrySchema` + `overlayMemoryEntrySchema`
     + `memoryEntryUpdatePatchSchema`. Absent ⇒ treated as `recall`.
   - `tierOf(memory)` helper: `memory.tier ?? "recall"`.
   - Export the schema/type/helper from `index.ts`.
   - RED test: old record (no tier) parses; `tierOf` ⇒ `recall`.

2. **Centralized tier-aware predicate (`memory-entry.ts`)** → verify: core vitest.
   - `isArchived(memory)` = `tierOf(memory) === "archival"`.
   - Extend `isRecallable(memory, asOf, options?: { includeArchival?: boolean })`:
     base = approved AND current; archival excluded unless `includeArchival`.
   - RED test: archival excluded by default, included with `includeArchival`;
     working/recall always pass the tier gate.

3. **`effectiveConfidence(memory, now)` (`memory-entry.ts`)** → verify: core vitest.
   - Pure: `baseWeight(confidence) × ageDecay(ageMs) × tierWeight(tier)`.
   - `baseWeight`: low 0.34 / medium 0.67 / high 1.0.
   - `ageDecay`: exponential half-life (e.g. 30 days), clamped `(0,1]`,
     `age ≤ 0 ⇒ 1`. Age from `updatedAt` (falls back to `createdAt`).
   - `tierWeight`: working 1.1 (small boost), recall 1.0, archival 1.0.
   - RED test: monotonic decrease with age (pinned `now`); recent-high >
     old-low; no wall-clock (all timestamps explicit).

4. **Decay ranking in `searchMemoryEntries` (`memory-search.ts`)** → verify: core vitest.
   - After BM25, multiply each hit's score by `effectiveConfidence(entry, now)`
     and re-sort (additive, never drops a hit). `now = asOf ?? now`.
   - Add `includeArchival` to the search query schema; default false ⇒ archival
     filtered via `isArchived` in the field filter (mirror semantic search).
   - Mirror the same `includeArchival` + archival filter in
     `memory-search-semantic.ts`.
   - RED test: recent-high ranks above old-low at equal BM25; archival excluded
     by default, present with `includeArchival`; a current recall memory with a
     BM25 hit is never dropped by decay.

5. **`sweepMemoryTiers(entries, now, policy?)` planner (`memory-entry.ts` or new
   `memory-sweep.ts`)** → verify: core vitest.
   - Pure: returns `{ archiveIds: MemoryEntryId[] }`. A candidate is archived iff
     currently `tierOf !== "archival"` AND
     (`stale` OR `validTo` closed-before-now (superseded/closed)
      OR (base confidence `low` AND inactive ≥ `maxIdleMs` since updatedAt)).
   - Default policy: `maxIdleMs = 90 days`.
   - RED test: old low-confidence → archived; recent high → untouched;
     idempotent (already-archival skipped); deterministic (pinned now).

6. **`mega memory sweep` CLI (`apps/cli/src/commands/memory/sweep.ts`)** → verify:
   CLI vitest (model-free, on-disk store).
   - Mirror `index-build.ts`: resolve store + project, list entries, run
     `sweepMemoryTiers`, `updateMemoryEntry({ tier: "archival", updatedAt })`
     for each archiveId. `--json` ⇒ `{ archived, scanned }`; text ⇒
     `archived=N scanned=M`. Register in `memory/index.ts` subCommands.
   - RED test: seeds old-low + recent-high; after sweep old-low has
     `tier=archival`, recent-high unchanged; both still present (lossless);
     summary counts; second run `archived=0`.

7. **`mega_memory_sweep` MCP tool (`packages/mcp-bridge/src/tools/sweep-memory.ts`)**
   → verify: mcp-bridge vitest.
   - Mirror `index-memory.ts`: input `{ projectId }`, run planner, apply updates,
     return `{ archived, scanned }`. Register name in `tool-name.ts` (alphabetic),
     def + dispatch in `server.ts`.
   - RED test: archives the old-low, returns counts, idempotent.

8. **Changeset + spec + wiki/log** → verify: `pnpm verify` (turbo build) green.
   - `.changeset/memory-tiered-decay.md` (minor: core, mcp-bridge, cli; daemon
     only re-exports core so include it for the bumped core dep — match M1).
   - Spec already marked DONE; append `wiki/log.md` entry.

## Verification gate
- Per-package vitest: core, mcp-bridge, daemon, cli.
- Full `pnpm verify` (lint + typecheck + test, via turbo build) — confirms the
  daemon resolves the new core exports from dist.
- RECALL-SAFETY assertion present and time-pinned.

## Risk notes (HIGH)
- Only mutation is the explicit sweep; decay is read-time pure; tier filter rides
  the one centralized predicate. No per-surface drift, no background process.
