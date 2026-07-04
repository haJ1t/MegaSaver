---
title: Memory Approval (Team/Cloud local slice)
tags: [concept, memory, approval, team, phase-10, archive]
sources:
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
  - syntheses/contextops-roadmap.md
  - entities/core.md
status: archived
created: 2026-06-12
updated: 2026-06-12
archived: 2026-07-04
redirect: concepts/structured-memory-engine.md
---

> **ARCHIVED 2026-07-04 — merged into [[concepts/structured-memory-engine]].**
> The full agent-suggests → human-approves policy, both gate points, the team
> = shared-store-+-gate model, the shipped-code reconciliation, and the
> mcp-bridge / cli / core links now live in the "## Approval gate" subsection
> of that page. Nothing was deleted; this page is kept for grep and history.
> Update structured-memory-engine, not this one.

# Memory Approval (Team/Cloud local slice)

Roadmap Phase 10 ("Team/Cloud"), the final phase. The roadmap block
describes a full cloud SaaS (team shared memory, permissions, approval
flow, cloud sync, org rules, audit logs, private deployment). Most of
that needs servers, auth, and hosting — none of it deterministically
testable here, all of it against `mega`'s local-first, single-binary
design. The whole phase is **scope discipline**: ship the deterministic
local slice that delivers the governance *intent*, and explicitly defer
genuine cloud (source: [[syntheses/contextops-roadmap]]).

## The local slice: an approval workflow

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

## Team = shared store + gate

Multiple agents share one `--store` path; only approved memory reaches
agents' config files. That **is** "everyone on the team uses the same
project memory," with no server.

## Reconciliation with shipped code

**Done** (PR #123): the `approval` field + backfill, both gate points,
`mega memory approve|reject` + `mega memory search --all` + an
`approval` column, the `approve_memory` MCP tool (the **25th** tool,
24 → 25), and `buildPrMemoryComment` (a pure Markdown builder) behind
`mega github pr-comment`.

## Explicitly deferred (cloud SaaS — no infra built)

Hosted sync, auth service, private deployment, org-level rules, hosted
audit service, web approval UI, and a memory `visibility` field. Spec
§8, plan §SCOPE.

## Related

- [[syntheses/contextops-roadmap]]
- [[concepts/structured-memory-engine]] (the entry being gated)
- [[entities/core]], [[entities/mcp-bridge]], [[entities/cli]]
