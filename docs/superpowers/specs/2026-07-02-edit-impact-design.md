---
title: Edit Impact — diff-driven impact pack (Slice 5)
date: 2026-07-02
status: approved
risk: MEDIUM
scope: get_edit_impact MCP tool + connector instruction
base: feat/seam-phase-2 (stacked; implemented after Phase 2)
reviewers: [code-reviewer, critic]
---

# Edit Impact (Slice 5)

The edit-time counterpart of `get_task_context`. `mega_impact(projectId,
symbol)` already exists (`mcp-bridge/src/tools/impact.ts:22` →
`buildImpactPack`, reverse-BFS over `resolvedCalledBy`). What's missing is
**symbol discovery from an edit**: the agent shouldn't have to know which
symbol it just changed.

## Design

New MCP tool `get_edit_impact({ projectId, changedFiles? })`:

1. **Changed files**: use `changedFiles` if provided; otherwise derive via
   `git diff --name-only HEAD` in `project.rootPath` (execFileSync, mirroring
   `readCoChangeLog`'s pattern at `context-pruner/src/read-cochange-log.ts:22`).
   Empty diff → empty result with an explanatory field, not an error.
2. **File → seed symbols**: `readManifest(paths).files[filePath].blockIds` →
   blocks (from `readBlocks`) → block `name`s. **No hunk parsing** (overmatch
   risk, locked decision). Cap seeds at `MAX_SEEDS = 8` (by block order —
   deterministic).
3. **Impact**: union of `buildImpactPack({symbol, blocks, maxTokens})` over the
   seeds, deduped by block id, budget-capped (single shared `maxTokens`,
   default matching `mega_impact`).
4. **Suggested tests**: from the union's included blocks, list blocks with
   `blockType === 'test'` plus test files among `calledBy` edges — returned as
   `suggestedTests: string[]` (file paths).
5. **Return shape**: `{ changedFiles, seeds, pack: ContextPack,
   suggestedTests }`.

Registration: 3 places (tool-name enum, TOOL_DEFS, dispatch), strict
alphabetical — the shipped `get_task_context` pattern. Validation:
`z.safeParse` + `McpBridgeError`; unknown project → the existing
`packFor`-style project-not-found error.

Connector: one instruction line in the managed block (after the
`get_task_context` line, `tokenSaver.enabled`-gated): after editing files, call
`get_edit_impact` to see impacted callers and which tests to run.

## Non-goals

Hunk-level symbol resolution; data-flow edges; non-TS FQN precision (name-based
fallback in `selectImpact` already handles it); auto-running the suggested
tests; daemon/file-watcher triggers (agent-pull only, consistent with the
mission's "agents connect to MegaSaver").

## Testing

TDD. Non-tautology requirements:
- Real indexed fixture repo: edit file A (function `a` called by `b` in file
  B, test block `t` covering B) → `get_edit_impact` returns B in pack and
  `t`'s file in `suggestedTests`. Mutation: dropping seed discovery (empty
  seeds) must fail the test.
- `changedFiles` explicit param bypasses git (works in a non-git store).
- Empty diff → `{changedFiles: [], seeds: [], …}` and no throw.
- Registry parity tests (tool count N→N+1) updated.
- Connector block test: instruction present iff `tokenSaver.enabled`.
