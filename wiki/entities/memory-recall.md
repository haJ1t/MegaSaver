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
matches the current title/content projection. Missing, malformed, or stale
vectors select Safe lexical ranking; partial current vectors retain every
eligible lexical candidate in Adaptive ranking. (source:
`packages/memory-recall/test/rank-project-memories.test.ts`)

## Consumers

Task-based CLI memory search, MCP `get_relevant_memories`, `search_memory`,
`mega_recall`, and the daemon registry recall handler all call this adapter.
(source: `apps/cli/src/commands/memory/search.ts`,
`packages/mcp-bridge/src/tools/{get-relevant-memories,search-memory,recall}.ts`,
`packages/daemon/src/handlers-registry.ts`)
