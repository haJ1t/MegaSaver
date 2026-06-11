---
title: Phase 1 — Structured Memory Engine (DIMMEM) — design
risk: HIGH
status: draft
created: 2026-06-11
updated: 2026-06-11
related:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/specs/2026-05-09-memory-entry-cli-design.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - wiki/concepts/structured-memory-engine.md
  - wiki/syntheses/contextops-roadmap.md
  - wiki/entities/core.md
---

# Phase 1 — Structured Memory Engine (DIMMEM) — design

## §0 TL;DR

Enrich the v0.1 `MemoryEntry` from a flat note (id, projectId,
sessionId, scope, content, createdAt) into a **typed engineering
memory**: add a `MemoryType` discriminant, a title, trust/lifecycle
metadata (confidence, source, keywords, relatedFiles, stale,
expiresAt), and the read/write surface the roadmap requires — `mega
memory search/show/update/delete/explain` on the CLI and
`save_memory`/`search_memory`/`get_relevant_memories` over MCP.

Search is **local, deterministic, keyword/field-based** (reuse
`@megasaver/retrieval` BM25 over title+content+keywords). No
embeddings, no LLM calls. This keeps Phase 1 offline, cheap, and
testable.

This is roadmap priority #1 (wiki/syntheses/contextops-roadmap.md); it
unblocks Phases 4 (MCP tools), 5 (rules are a `MemoryType`), 6 (steps
save memory), and 8 (`memoriesRetrieved` metric).

## §1 Motivation

The v0.1 slice (`2026-05-09-memory-entry-cli-design.md`) shipped memory
as "text content plus scope" and explicitly deferred type, metadata,
search, and the MCP write/search tools (its §2). That was correct for
v0.1 — but it means the connector context block currently renders
undifferentiated notes, an agent cannot ask "what auth decisions were
made here," and nothing else in the roadmap can build on memory.

DIMMEM (wiki/concepts/structured-memory-engine.md) is the heart of the
product: atomic, typed, self-contained, multi-dimensionally searchable
memories that any agent in any session can retrieve and trust.

## §2 Non-goals

- **No embeddings / vector search / LLM calls.** Search is BM25 +
  field filters. Semantic embeddings are a later phase (fikri §15.4
  "Knowledge Graph / Temporal Memory").
- **No SQLite migration.** Stay on the JSON-directory store
  (`2026-05-05-core-persistence-design.md` §4 keeps SQLite deferred).
  Phase 1 must not gate on a storage rewrite.
- **No cross-project memory.** Memory stays project-scoped (with the
  existing project/session scope split).
- **No team/approval/permissions.** That is Phase 10.
- **No automatic memory extraction** from sessions/diffs. `source` can
  record where a memory came from, but auto-capture pipelines (Phase 5
  failure→memory, Phase 6 task→memory) are their own specs.

## §3 Schema changes (`packages/core/src/memory-entry.ts`)

Extend `memoryEntrySchema`. New `memoryTypeSchema` enum (10 members,
ordered as in the roadmap):

```
decision | bug | architecture | todo | user_preference |
failed_attempt | code_pattern | project_rule | dependency |
test_behavior
```

`MemoryEntry` gains:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `MemoryType` | yes | discriminant |
| `title` | `titleSchema` | yes | reuse `@megasaver/shared` `titleSchema` |
| `keywords` | `string[]` | yes (may be `[]`) | lowercased, deduped, trimmed |
| `confidence` | `low\|medium\|high` | yes | default `medium` at CLI boundary |
| `source` | `manual\|agent\|test_failure\|git_diff\|session_summary` | yes | default `manual` |
| `reason` | `string` | no | the "why" |
| `goal` | `string` | no | |
| `evidence` | `string[]` | no | citations/links |
| `relatedFiles` | `string[]` | no | repo-relative paths |
| `relatedSymbols` | `string[]` | no | |
| `stale` | `boolean` | no (default `false`) | |
| `updatedAt` | datetime | yes | mirrors createdAt on create |
| `expiresAt` | datetime | no (nullable) | |

`content`, `scope`, `id`, `projectId`, `sessionId`, `createdAt` keep
their current meaning and validation (scope/sessionId superRefine
unchanged). Pre-1.0 we **break the schema** rather than version it
(CLAUDE.md §13: no backward-compat shims). A one-shot migration
(§8) upgrades existing on-disk entries.

## §4 Registry surface (`packages/core/src/registry.ts`)

The v0.1 registry is **append-only** (create/get/list only). DIMMEM
needs mutability. Decision: make memory entries **mutable in place**
(not event-sourced) — simplest model that satisfies `update`/`delete`/
`stale`. Add to `CoreRegistry`:

- `updateMemoryEntry(id, patch): MemoryEntry` — partial update;
  re-validates; bumps `updatedAt`; cannot change `id`/`projectId`/
  `createdAt`/`scope`.
- `deleteMemoryEntry(id): void` — hard delete.
- `searchMemoryEntries(projectId, query): MemoryEntry[]` — see §7.

`createMemoryEntry` signature widens to accept the new required fields
(with CLI-side defaults). JSON-directory + in-memory implementations
both updated; JSONL files become one-object-per-line **mutable** sets
(rewrite-file-on-change, atomic, same `atomicWriteFile` path already
used by the store).

## §5 CLI surface (`apps/cli/src/commands/memory/`)

Existing: `create`, `list`, `show`. Add/extend:

- `mega memory create` — gains `--type <t>` (required), `--title "…"`
  (required), repeatable `--keyword`, `--confidence`, `--source`,
  `--reason`, `--goal`, repeatable `--file` (relatedFiles), `--expires`.
  Keeps `--scope`/`--content`/`--session`. Boundary re-parse per the
  parse-on-handoff policy (CLAUDE.md §8): content + title re-validated
  because the connector renderer writes them verbatim.
- `mega memory search <project> "<query>"` — `--type`, `--confidence`,
  `--limit` filters; prints ranked `id  type  confidence  title`.
- `mega memory show <id>` — extend key=value view to all fields.
- `mega memory update <id>` — same flags as create (all optional);
  `--stale`/`--no-stale`.
- `mega memory delete <id>` — `--yes` to skip confirm.
- `mega memory explain <id>` — human-readable rendering: title, type,
  why (reason/goal), evidence, related files/symbols, confidence,
  freshness (stale/expiresAt), provenance (source/createdAt).

`--json` supported on list/search/show/explain (mirror
`2026-05-10-json-memory-design.md`).

## §6 MCP tools (`packages/mcp-bridge/src/tools/`)

The 4-tool surface is locked by AA1 (`2026-05-10-aa1-context-gate-epic.md`
§8a). DIMMEM **adds** tools — a deliberate post-AA1 surface extension,
flagged here per §4 process discipline. New `mcpToolName` enum members:

- `save_memory(projectId, type, title, content, scope, …)` →
  `{ id }`. Writes via `createMemoryEntry`.
- `search_memory(projectId, query, filters?)` → ranked entries.
- `get_relevant_memories(projectId, task)` → top-N by relevance to a
  free-text task (BM25 over the derived task terms; §7).

`tool-name.ts` closed enum widens from 4 → 7; `server.ts` `TOOL_DEFS`
gains three entries; each tool gets its own file + test (mirror the
existing `recall.ts` shape). Tools reject session-scope writes without
a `sessionId` (same superRefine).

## §7 Search & relevance (reuse `@megasaver/retrieval`)

`searchMemoryEntries` builds a per-entry document
`title + " " + content + " " + keywords.join(" ")` and ranks with the
existing `rankBm25`. Field filters (`type`, `confidence`, `scope`,
`stale=false` by default) apply before ranking. `get_relevant_memories`
runs `deriveIntent` on the task string to get query terms, then the
same BM25 path. Deterministic, offline, already-tested ranker — no new
scoring math in Phase 1.

## §8 Storage & migration

On-disk memory JSONL files predate the new fields. A one-shot upgrade
runs lazily on first read of a project's memory set. Legacy rows are
backfilled to the neutral defaults: `type:"todo"`, `title:` first 59
chars of `content`, `confidence:"low"`, `source:"manual"`,
`keywords:[]`, `stale:false`, `updatedAt:createdAt`. The new required
fields are enforced for all *new* writes; the backfill is what makes
existing rows valid. Backfill is **idempotent** (re-running is a no-op)
and writes back atomically. Covered by a dedicated migration test with
a fixture of v0.1-shaped rows.

## §9 Risk

**HIGH** (CLAUDE.md §12 — "memory schema change" + "session storage
format" are named HIGH examples). Mandatory: full superpowers chain +
`architect` design pass + `critic` adversarial review + worktree.
Required reviewers: `code-reviewer` AND `critic`. The migration path
(§8) and the connector-render boundary (verbatim write of title/content
→ corruption risk) are the highest-risk surfaces.

## §10 Testing

- Schema: every new field validated; superRefine scope rules intact;
  invalid `type`/`confidence`/`source` rejected (closed-enum tripwire,
  per `2026-05-09-closed-enum-tripwire-design.md`).
- Registry: create/update/delete/search on both in-memory and
  JSON-directory impls; update cannot mutate immutable fields; delete
  removes from disk atomically.
- Migration: v0.1 fixture → upgraded shape, idempotent on re-run.
- CLI: each subcommand happy-path + boundary-rejection; `--json`
  shapes; `delete --yes` vs confirm.
- MCP: save/search/get_relevant e2e against the stdio server (mirror
  `server.e2e.test.ts`).
- Connector render: enriched entries still render valid agent blocks.

## §11 Decisions / open questions

1. **Mutable vs event-sourced memory** → mutable in place (§4). Simpler;
   the append-only invariant from v0.1 is dropped intentionally.
2. **Legacy backfill default `type`** → `todo` (§8), the most neutral
   bucket; reviewer may override.
3. **`relatedFiles` validation** → trimmed strings, no existence check
   (files may be planned/deleted). Open: normalize to repo-relative?
   Recommend yes, defer enforcement to Phase 2 when the index exists.

## §12 Out of scope

- Embeddings / semantic vector search.
- SQLite backend.
- Auto memory extraction from sessions, diffs, or failures (Phase 5).
- The `get_relevant_code_blocks` MCP tool (Phase 2/4).
- Team/permission/approval (Phase 10).
