---
title: Structured Memory Engine (DIMMEM)
tags: [concept, memory, dimmem, phase-1, approval, team, phase-10]
sources:
  - sources/roadmap-phases-v2.md
  - syntheses/contextops-roadmap.md
  - entities/core.md
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
status: active
created: 2026-06-11
updated: 2026-07-04
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

## Approval gate

Folded in 2026-07-04 from the retired `concepts/memory-approval.md`
(roadmap Phase 10, "Team/Cloud" — the final phase). The roadmap block
describes a full cloud SaaS (team shared memory, permissions, approval
flow, cloud sync, org rules, audit logs, private deployment). Most of
that needs servers, auth, and hosting — none of it deterministically
testable here, all of it against `mega`'s local-first, single-binary
design. The whole phase is **scope discipline**: ship the deterministic
local slice that delivers the governance *intent*, and explicitly defer
genuine cloud (source: [[syntheses/contextops-roadmap]]).

### The local slice: an approval workflow

1. **Schema.** `MemoryEntry` gains one closed-enum field
   `approval: "suggested" | "approved" | "rejected"`.
   `backfillMemoryEntry` defaults **every** pre-Phase-10 row to
   `approved` so nothing disappears from live stores (backward compat,
   no migration script).
2. **Default by author.** An **agent** writing via `save_memory`
   defaults to `suggested` (a machine proposes); a **human** running
   `mega memory create` defaults to `approved` (a person asserts). The
   agent-suggests → human-approves flow, done with defaults, no UI.
3. **The gate (the exit mechanism).** Only `approved` memory is shared.
   `suggested` / `rejected` is excluded at every chokepoint:
   - Gate point 1 — `searchMemoryEntries` gains `includeUnapproved`
     (default `false`), the single transitive chokepoint for
     `search_memory` / `get_relevant_memories` / context pack.
   - Gate point 2 — four explicit `approval === "approved"` filters on
     list-consumers: connector sync (`buildConnectorContext`, CLI +
     GUI mirror), `get_project_context`, and `mega_recall`.

A `--all` / `includeUnapproved: true` opt-in surfaces pending
suggestions for human review.

### Team = shared store + gate

Multiple agents share one `--store` path; only approved memory reaches
agents' config files. That **is** "everyone on the team uses the same
project memory," with no server.

### Approval gate — reconciliation with shipped code

**Done** (PR #123): the `approval` field + backfill, both gate points,
`mega memory approve|reject` + `mega memory search --all` + an
`approval` column, the `approve_memory` MCP tool (the **25th** tool,
24 → 25), and `buildPrMemoryComment` (a pure Markdown builder) behind
`mega github pr-comment`.

### Approval gate — explicitly deferred (cloud SaaS — no infra built)

Hosted sync, auth service, private deployment, org-level rules, hosted
audit service, web approval UI, and a memory `visibility` field. Spec
§8, plan §SCOPE. Approval-gate spec:
`docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md`.

Approval-gate related pages: [[entities/mcp-bridge]] (the `approve_memory`
tool), [[entities/cli]] (`mega memory approve|reject|search --all`),
[[entities/core]], [[syntheses/contextops-roadmap]].

## Related

- [[syntheses/contextops-roadmap]]
- [[concepts/memory-superset]] (WS3 — semantic recall + entity graph on top of DIMMEM)
- [[concepts/context-pruning-engine]] (consumes memory relevance)
- [[entities/core]]
