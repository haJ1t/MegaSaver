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

New MCP tool `get_edit_impact({ projectId, changedFiles?, maxTokens?,
limit? })`:

1. **Changed files**: use `changedFiles` if provided; otherwise derive via
   `git -c core.quotePath=off diff --name-only HEAD` in `project.rootPath`
   (execFileSync, mirroring `readCoChangeLog`'s pattern at
   `context-pruner/src/read-cochange-log.ts:22`, with a 5s timeout +
   maxBuffer so a hung hook cannot block the MCP handler). `quotePath=off`
   keeps non-ASCII paths verbatim so they match manifest keys. Explicit
   `changedFiles` are normalized to manifest-key shape before lookup:
   absolute → relative to `project.rootPath`, backslashes → posix, leading
   `./` stripped. Empty result carries a `reason` discriminator:
   `'no-changes'` (clean tree / explicit empty list) vs `'git-unavailable'`
   (non-git root, git missing, no HEAD). Manifest lookups go through
   `Object.hasOwn` — the record is JSON-derived, so bare lookups of
   `__proto__`/`constructor`/`toString` would hit the prototype chain.
2. **File → seed symbols**: `readManifest(paths).files[filePath].blockIds` →
   blocks (from `readBlocks`) → block `name`s. **No hunk parsing** (overmatch
   risk, locked decision). Cap seeds at `MAX_SEEDS = 8` (by block order —
   deterministic). Changed files with no manifest entry are reported in
   `unmatchedFiles` (never silently dropped).
3. **Impact**: union of `buildImpactPack({symbol, blocks, maxTokens, limit})`
   over the seeds (both knobs optional, mirroring `mega_impact`'s input
   schema), deduped by block id. `maxTokens` is re-enforced as a SHARED cap
   over the merged union — per-seed packs each fit the budget but their union
   may not; lowest-score included blocks drop first (blockId tie-break,
   deterministic), landing in `excluded` with the budget reason, and
   `usedTokens` is recomputed.
4. **Suggested tests**: union of two strategies, deduped, capped at 10,
   deterministic order (pack traversal order, then sorted heuristic hits):
   - **Block-type scan**: blocks with `blockType === 'test'` among the merged
     pack's included AND excluded (budget-cut test blocks still surface),
     plus test-typed DIRECT callers of included blocks via
     `resolvedCalledBy`/`calledBy` edges (budget-immune).
   - **Filename heuristic over manifest keys**: real Vitest/Jest files are
     bare top-level `describe()` calls — the TS extractor emits NO named
     blocks for them, so they can never appear as callers. For each impacted
     file F (matched changed files + included blocks' files), suggest
     manifest files matching test-name conventions (`*.test.*`, `*.spec.*`,
     `__tests__/` dir) whose basename stem matches F's stem or that live in
     F's directory.
5. **Return shape**: `{ changedFiles, unmatchedFiles, seeds,
   pack: ContextPack, suggestedTests, reason? }`.

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
mission's "agents connect to MegaSaver"). Seed-name collisions are ACCEPTED:
two same-named functions in two changed files seed a single reverse-BFS root
(name-based seeding is the indexer's own non-TS fallback; FQN seeding is not
implemented).

## Testing

TDD. Non-tautology requirements:
- Real indexed fixture repo: edit file A (function `a` called by `b` in file
  B, test block `t` covering B) → `get_edit_impact` returns B in pack and
  `t`'s file in `suggestedTests`. Mutation: dropping seed discovery (empty
  seeds) must fail the test.
- Bare-describe fixture: a test file that is a top-level `describe()` with no
  named declarations (zero indexed blocks) covering `src/a.ts` →
  `suggestedTests` contains it via the filename heuristic. Mutation: removing
  the heuristic must fail.
- Budget-cut fixture: seed with >8 callers including one indexed test block
  (stem/dir chosen so the heuristic cannot match) → the test file is still
  suggested via the block-type scan over the blast radius.
- Path normalization: absolute input matches; `src\\a.ts` matches; unmatched
  garbage lands in `unmatchedFiles`; `changedFiles: ["__proto__"]` yields no
  seeds and no throw.
- Shared budget: a small `maxTokens` shrinks the merged union
  (`budget.maxTokens` echoed, drops carry the budget exclusion reason);
  `limit: 1` restricts each per-seed pack to its root.
- Empty-result discriminator: non-git root → `reason: 'git-unavailable'`;
  clean git tree / explicit empty list → `reason: 'no-changes'`.
- `changedFiles` explicit param bypasses git (works in a non-git store).
- Registry parity tests (tool count N→N+1) updated.
- Connector block test: instruction present iff `tokenSaver.enabled`.
