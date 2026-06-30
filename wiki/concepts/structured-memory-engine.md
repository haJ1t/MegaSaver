---
title: Structured Memory Engine (DIMMEM)
tags: [concept, memory, dimmem, phase-1]
sources:
  - sources/roadmap-phases-v2.md
  - syntheses/contextops-roadmap.md
  - entities/core.md
status: active
created: 2026-06-11
updated: 2026-06-11
---

# Structured Memory Engine (DIMMEM)

Roadmap Phase 1. The heart of Mega Saver: not flat chat history but
**structured engineering memory** — atomic, typed, self-contained
entries searchable along multiple dimensions. "DIMMEM" is the
roadmap's borrowed name for the pattern (source:
[[sources/roadmap-phases-v2]]).

## Core idea

Each memory is one fact an agent should not have to re-derive: a
decision, a bug, an architecture choice, a failed attempt, a project
rule. It carries enough metadata (type, confidence, source, related
files, keywords, freshness) to be retrieved and trusted later, by any
agent, in a different session.

## Memory shape (roadmap target)

- `type`: decision | bug | architecture | todo | user_preference |
  failed_attempt | code_pattern | project_rule | dependency |
  test_behavior
- identity/links: `title`, `content`, optional `reason`/`goal`/
  `evidence[]`, `relatedFiles[]`, `relatedSymbols[]`, `keywords[]`
- trust/lifecycle: `confidence` (low/medium/high), `source`
  (manual/agent/test_failure/git_diff/session_summary), `stale`,
  `expiresAt`

## Reconciliation with shipped code

The v0.1 `MemoryEntry` (`packages/core/src/memory-entry.ts`) is the
seed: id, projectId, sessionId, scope, content, createdAt — append-only
CRUD, `mega memory create/list/show`, `mega_recall`. The rich typed
schema, `search`/`delete`/`update`/`explain`, and the
`save_memory`/`search_memory`/`get_relevant_memories` MCP tools are
**net-new**: the CLI delete/update/search were listed as non-goals in
`2026-05-09-memory-entry-cli-design.md` §2, the flat-content schema in
`2026-05-04-core-package-design.md` §5c, and the MCP memory tools were
never specced before Phase 1. Status: **partial**. Spec:
`docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md`.

## Why it matters

DIMMEM unblocks FORGE (a `ProjectRule` is a `MemoryType`), the Task
Engine (steps `save_memory`), and the Audit metric `memoriesRetrieved`.
It is priority #1 because most of the rest depends on it.

## Related

- [[syntheses/contextops-roadmap]]
- [[concepts/memory-superset]] (WS3 — semantic recall + entity graph on top of DIMMEM)
- [[concepts/context-pruning-engine]] (consumes memory relevance)
- [[entities/core]]
