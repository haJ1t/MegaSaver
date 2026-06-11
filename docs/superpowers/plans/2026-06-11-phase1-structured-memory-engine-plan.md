# Phase 1 — Structured Memory Engine (DIMMEM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Risk: **HIGH** — full chain + `architect` design pass + `critic` + `code-reviewer` (separate passes) + worktree are mandatory.

**Goal:** Upgrade `MemoryEntry` from a flat note to a typed engineering memory (10 `MemoryType`s + trust/lifecycle metadata), with `mega memory search/update/delete/explain` and `save_memory`/`search_memory`/`get_relevant_memories` MCP tools. Search is local BM25 (no embeddings, no LLM).

**Architecture:** Schema enrichment in `@megasaver/core` (`memory-entry.ts`); registry gains `update/delete/search` on both in-memory and JSON-directory impls (memory becomes mutable-in-place); a lazy idempotent backfill upgrades v0.1 rows; CLI extends `memory/` commands; `@megasaver/mcp-bridge` widens its closed tool enum 4→7; search reuses `@megasaver/retrieval` `rankBm25`. Spec: `docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md`.

**Tech Stack:** TypeScript strict ESM, Vitest, pnpm workspaces, Zod, Citty CLI, `@modelcontextprotocol/sdk`.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/phase1-memory`, branch `feat/phase1-structured-memory`. Run all commands from the worktree root.

---

### Task 1: Enrich `MemoryType` + schema

**Files:** Modify `packages/core/src/memory-entry.ts`; test `packages/core/test/memory-entry.test.ts`.

- [ ] **Step 1: Failing test** — assert `memoryTypeSchema` accepts all 10 members and rejects unknown; assert enriched `memoryEntrySchema` requires `type`/`title`/`keywords`/`confidence`/`source`/`updatedAt`, accepts optional `reason`/`goal`/`evidence`/`relatedFiles`/`relatedSymbols`/`stale`/`expiresAt`, and preserves the scope/sessionId superRefine.
- [ ] **Step 2: Run — expect FAIL** (`pnpm --filter @megasaver/core test -- memory-entry`).
- [ ] **Step 3: Implement** — add `memoryTypeSchema` (z.enum, roadmap order), extend the object, reuse `titleSchema` from `@megasaver/shared`; keywords transform = lowercase+trim+dedupe; keep `.strict()`.
- [ ] **Step 4: Run — expect PASS** + `pnpm --filter @megasaver/core typecheck`.
- [ ] **Step 5: Commit** — `feat(core): typed MemoryType + metadata on MemoryEntry`.

### Task 2: Registry update/delete/search (in-memory)

**Files:** Modify `packages/core/src/registry.ts`; test `packages/core/test/registry.test.ts`.

- [ ] **Step 1: Failing test** — `updateMemoryEntry` patches mutable fields + bumps `updatedAt`, rejects changing id/projectId/createdAt/scope; `deleteMemoryEntry` removes; `searchMemoryEntries` returns BM25-ranked entries with `type`/`confidence`/`stale` filters.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — widen `CoreRegistry` interface + in-memory impl; `searchMemoryEntries` builds `title+content+keywords` docs and calls `rankBm25` from `@megasaver/retrieval` (add workspace dep).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): mutable memory registry + BM25 search`.

### Task 3: JSON-directory registry parity + atomic rewrite

**Files:** Modify `packages/core/src/json-directory-registry.ts`, `json-directory-store.ts`; test `packages/core/test/json-directory-registry.test.ts`.

- [ ] **Step 1: Failing test** — update/delete persist atomically; reload reflects changes; concurrent-safe via existing lock path.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — memory JSONL becomes rewrite-on-change via `atomicWriteFile` (reuse existing fsync/`r+` Windows path).
- [ ] **Step 4: Run — expect PASS** on both OS legs locally where possible.
- [ ] **Step 5: Commit** — `feat(core): persist memory update/delete atomically`.

### Task 4: Lazy idempotent v0.1 backfill

**Files:** Add `packages/core/src/memory-migrate.ts`; test `packages/core/test/memory-migrate.test.ts` with a v0.1-shaped fixture.

- [ ] **Step 1: Failing test** — legacy row (no type/title/…) → `type:"todo"`, `title:`first 59 chars, `confidence:"low"`, `source:"manual"`, `keywords:[]`, `stale:false`, `updatedAt:createdAt`; second run is a no-op (idempotent).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — backfill on first read of a project's memory set; write back atomically only if changed.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): idempotent v0.1 memory backfill`.

### Task 5: CLI — create flags + search/update/delete/explain

**Files:** Modify `apps/cli/src/commands/memory/{create,list,show,shared,index}.ts`; add `search.ts`, `update.ts`, `delete.ts`, `explain.ts`; test `apps/cli/test/memory.test.ts`.

- [ ] **Step 1: Failing test** — create accepts `--type`/`--title`/`--keyword`(repeat)/`--confidence`/`--source`/`--reason`/`--goal`/`--file`/`--expires`; defaults (`confidence=medium`, `source=manual`); `search` ranks + filters; `update` patches; `delete --yes` removes (confirm otherwise); `explain` renders all fields; `--json` shapes on list/search/show/explain.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — boundary re-parse of title+content (parse-on-handoff policy, CLAUDE.md §8); register new subcommands in `memory/index.ts`.
- [ ] **Step 4: Run — expect PASS** + CLI smoke capture for DoD §5.
- [ ] **Step 5: Commit** — `feat(cli): mega memory search/update/delete/explain + typed create`.

### Task 6: MCP tools save/search/get_relevant

**Files:** `packages/mcp-bridge/src/tool-name.ts` (4→7 enum), `server.ts` (TOOL_DEFS), add `tools/{save-memory,search-memory,get-relevant-memories}.ts`; tests under `packages/mcp-bridge/test/tools/` + `server.e2e.test.ts`.

- [ ] **Step 1: Failing test** — each tool validates input, dispatches, returns expected shape; session-scope write without sessionId rejected; e2e over stdio.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — mirror `recall.ts`; `get_relevant_memories` runs `deriveIntent(task)` → BM25.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(mcp-bridge): save_memory/search_memory/get_relevant_memories`.

### Task 7: Connector render compat + closeout

**Files:** `apps/cli/src/commands/connector/shared.ts` + connector tests; `.changeset/`; `docs/conventions/` only if conventions changed.

- [ ] **Step 1:** Verify enriched entries still render valid agent blocks (connector render test); fix renderer if titles/content corrupt output.
- [ ] **Step 2:** `pnpm verify` green (lint + typecheck + test, both OS legs in CI).
- [ ] **Step 3:** Add changesets for `@megasaver/core`, `@megasaver/cli`, `@megasaver/mcp-bridge` (public API changed).
- [ ] **Step 4:** `critic` + `code-reviewer` passes (separate contexts, HIGH risk); `omc:verify` evidence.
- [ ] **Step 5:** Update `wiki/entities/core.md`, append `wiki/log.md`; `superpowers:finishing-a-development-branch`.
