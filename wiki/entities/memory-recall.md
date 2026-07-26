---
title: LM2 Product Memory Recall Adapter
tags: [entity, memory, recall, lm2]
sources:
  - docs/superpowers/specs/2026-07-26-lm2-product-memory-integration-design.md
  - docs/superpowers/plans/2026-07-26-lm2-product-memory-integration-plan.md
  - packages/memory-recall/src/rank-project-memories.ts
status: active
created: 2026-07-26
updated: 2026-07-26
---

## Role

`@megasaver/memory-recall` ranks the authoritative Core `MemoryEntry` records;
it does not create another memory store or bypass Core approval, validity, stale,
and scope gates. It is read-only. (source:
`packages/memory-recall/src/rank-project-memories.ts`)

## Safety

Adaptive ranking uses only existing project vector sidecars whose hash manifest
matches the current title/content projection. A genuinely absent sidecar selects
Safe lexical ranking. A present but malformed, oversized, or concurrently
changed vector or hash sidecar preserves lexical recall while returning an
Adaptive degraded receipt with `vector_read_limit`; partial current vectors
retain every eligible lexical candidate. (source:
`packages/memory-recall/src/rank-project-memories.ts`,
`packages/memory-recall/test/rank-project-memories.test.ts`)

Candidate selection first uses Core's task-aware lexical ordering, so the LM2
window cannot silently exclude a relevant older memory merely because 1,000
newer records exist. Above that window, it preserves up to 500 lexical hits,
then distributes the remaining indexed slots across the whole eligible indexed
set before filling with newest eligible memories; this retains an older indexed
semantic candidate even when both budgets are saturated. A task or candidate
projection beyond LM2's 50,000-code-unit input limit, or a candidate set whose
UTF-8 corpus exceeds LM2's 64 MiB bound, returns Core lexical recall with a
Safe receipt rather than surfacing an LM2 validation error to a product caller.
(source:
`packages/memory-recall/src/rank-project-memories.ts`,
`packages/memory-recall/test/rank-project-memories.test.ts`)

## Consumers

Task-based CLI memory search, MCP `get_relevant_memories`, `search_memory`,
`mega_recall`, and the daemon registry recall handler all call this adapter.
(source: `apps/cli/src/commands/memory/search.ts`,
`packages/mcp-bridge/src/tools/{get-relevant-memories,search-memory,recall}.ts`,
`packages/daemon/src/handlers-registry.ts`)

The concrete cross-surface fixture proves the same Safe ordered ids through the
adapter, MCP relevant-memory/search, daemon registry recall, and CLI search;
an unapproved proposed memory stays excluded. (source:
`apps/cli/test/memory/hybrid-recall-surfaces.test.ts`)
