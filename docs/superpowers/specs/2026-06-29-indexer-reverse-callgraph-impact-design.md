---
title: Reverse call-graph blast-radius (mega_impact)
status: approved
risk: medium
created: 2026-06-29
---

# Reverse call-graph blast-radius (`mega_impact`)

## Goal

Answer "who is affected if I change this symbol?" in one tool call,
returning ONLY the transitive callers of an edit site (its true blast
radius) instead of forcing the agent to grep-and-read every "who calls
this" candidate. Lever: ~80–90% cut on caller-exploration tokens; the
returned closure is exhaustive within the token budget and never
silently drops a caller.

## Mechanism (locked design)

1. **Populate `CodeBlock.calledBy` at index build time.** Today it is
   hard-coded `[]` in `packages/indexer/src/extract/extract-ts.ts`
   (~line 113). The extractor has no cross-file view, so leave it `[]`
   there and instead fill `calledBy` in `packages/indexer/src/build.ts`
   *after* all blocks for the project exist: invert the name-resolved
   `calls` edges. Reuse the `byName` resolution pattern that
   `context-pruner/src/select.ts` already uses for its forward BFS
   (build a `name/export → block` map, first-writer-wins, deterministic)
   to resolve each `calls` entry to a target block, then append the
   caller's id to that target's `calledBy`.

2. **Reverse-BFS selection.** Given an edit site (a block name, or
   `file:line`), walk `calledBy` transitively to collect the blocks
   affected by changing that symbol. Mirror the forward closure in
   `select.ts` (~line 86): same visited/`includedIds` guard, same
   `add()`/budget/`reasons` machinery — only the edge direction flips
   (`calledBy` instead of `calls`). Closure stops at the existing
   context-pruner token budget; nothing else is special-cased.

3. **MCP tool `mega_impact`.** Expose the reverse-BFS as an MCP tool in
   `packages/mcp-bridge/src/tools/`, following the existing
   `context-pruning.ts` / `search-code.ts` tool pattern (Zod input
   schema, returns a pack), and register it in the `server.ts` dispatch.

## Files to touch

- `packages/indexer/src/build.ts` — invert `calls` → `calledBy` after
  all blocks exist (new pass, reusing `byName`-style resolution).
- `packages/indexer/src/extract/extract-ts.ts` — leave `calledBy: []`
  (no cross-file data at extract time); confirm only, no behavior
  change expected.
- `packages/context-pruner/src/select.ts` — add reverse-BFS selection
  over `calledBy` mirroring the forward closure.
- `packages/mcp-bridge/src/tools/impact.ts` (new) — `mega_impact` tool.
- `packages/mcp-bridge/src/server.ts` — register `mega_impact` in
  dispatch.

## Lossless / evidence-preservation note

`mega_impact` only changes what is RETURNED, never what is recoverable:
raw output is still persisted to a ChunkSet and expandable via
`mega_fetch_chunk`. The closure is deterministic (no LLM calls) and
exhaustive within budget — when the budget truncates, that is surfaced
via the existing `reasons` ("budget") machinery, never a silent drop.
Distinct callers stay distinct; no caller is merged or hidden. Tool is
tool-resident (works on Claude Desktop via MCP).

## Test plan

1. **`calledBy` is the inverse of `calls`.** Multi-function fixture
   where `a` calls `b` and `c` call `b`; after `buildIndex`, `b.calledBy`
   contains `a` and `c` (and only those), and a leaf with no callers has
   `calledBy === []`.
2. **Reverse-BFS returns exactly the transitive callers within budget.**
   Chain `a → b → c` (calls); reverse-BFS from `c` returns `b` and `a`
   (and not unrelated blocks); with a tight budget the closure stops at
   the budget and the cut is reported via `reasons`, not dropped.
3. **MCP tool returns a pack for a given symbol.** `mega_impact` invoked
   with a known symbol returns a pack containing its transitive callers.
4. **Unknown symbol returns empty, no crash.** `mega_impact` with a
   symbol absent from the index returns an empty pack (no throw).

## Out-of-scope

- No indexer rewrite — only the reverse edge, reverse-BFS, and tool.
- No new edge types beyond inverting `calls`.
- No re-ranking / scoring changes in the context-pruner.
- No CLI surface (`mega_impact` is MCP-only for this feature).
- Non-TS extractors (`extract-json`, `extract-md`) unchanged; reverse
  edges follow whatever `calls` those already emit.
