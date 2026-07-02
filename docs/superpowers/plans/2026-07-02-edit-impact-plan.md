# Edit Impact Implementation Plan

> **For agentic workers:** superpowers:subagent-driven-development. TDD; `pnpm build` after src edits; `pnpm verify` at task boundaries.

**Spec:** `docs/superpowers/specs/2026-07-02-edit-impact-design.md`
**Branch:** `feat/edit-impact` (stacked on `feat/seam-phase-2`).
**Risk:** MEDIUM (new public MCP tool surface) → code-reviewer + critic before PR.

## Task B.1 — `get_edit_impact` tool

**Files:** new `packages/mcp-bridge/src/tools/get-edit-impact.ts`; register in `src/tool-name.ts` (enum), `src/server.ts` (TOOL_DEFS + dispatch + import) — strict alphabetical (lands right after `get_context_budget_report`, before `get_relevant_*`; verify real order). Tests: `test/tools/get-edit-impact.test.ts` + parity tests count N→N+1 (`tool-name-task.test.ts`, `tool-name.test-d.ts`, `server.e2e.test.ts` — the `get_task_context` commit `d7c42ae8` shows every touchpoint).

**Grounded building blocks (verified):**
- `handleImpact` (`src/tools/impact.ts:22`): args `{projectId, symbol, maxTokens?, limit?}` → `ContextPack`; unknown symbol → empty pack, no throw. Reuse its env/`resolveIndexPaths` pattern.
- `readManifest(paths)` → `files: Record<filePath, {blockIds: string[]}>`; `readBlocks(paths)` → `CodeBlock[]` (`indexer/src/store.ts:52`).
- `buildImpactPack({symbol, blocks, limit?, maxTokens?})` (`context-pruner/src/pack.ts:129`).
- git pattern: `readCoChangeLog` (`context-pruner/src/read-cochange-log.ts:22`) — `execFileSync('git', […], {cwd})`, graceful empty on failure. Mirror: `git diff --name-only HEAD` in `project.rootPath`; non-git / empty diff → `[]`, never throw.

**Behavior (spec):**
1. `changedFiles` param wins; else git diff; empty → `{changedFiles: [], seeds: [], pack: emptyPack, suggestedTests: []}` (shape mirrors `buildImpactPack`'s empty result).
2. Seeds: manifest lookup per changed file → blockIds → block `name`s (skip nameless), dedup, **first 8** (deterministic file/block order). No hunk parsing.
3. Pack: union of `buildImpactPack` per seed (shared `maxTokens`, default = whatever `handleImpact` defaults), dedup `included`/`excluded` by block id; `task` field = `edit-impact: <seeds joined>`.
4. `suggestedTests`: from union `included`, file paths of blocks with `blockType === 'test'`, dedup.
5. Validation: `z.safeParse` (`projectId` min 1, `changedFiles` optional string array) + `McpBridgeError('validation_failed')`; unknown project → the existing project-not-found error path.

**Tests (non-tautological):** fixture repo (mirror `get-task-context.test.ts` harness: `mkdtemp` + `buildIndex` + in-memory registry): file A `fn a` called by B's `fn b`, test file T calling `b` (blockType test via filename/heuristics the indexer already applies — confirm how the indexer marks test blocks and construct accordingly) → explicit `changedFiles: ['src/a.ts']` returns B in pack + T in suggestedTests (mutation target: dropping seed discovery must fail); empty diff behavior; missing task/projectId rejection; unknown project rejection. Parity tests updated.

## Task B.2 — connector instruction line

**Files:** `packages/connectors/shared/src/context-gate-block.ts` (line after the `get_task_context` instruction, before END sentinel), `packages/connectors/shared/test/context-gate-block.test.ts`. Note: package filter is `@megasaver/connectors-shared`.

Text: after editing files, call `get_edit_impact({ projectId })` to see impacted callers and which tests to run. Gate: existing `tokenSaver.enabled` (returns `""` disabled — assert both).

## Final gate

`pnpm verify`; changeset (`@megasaver/mcp-bridge` minor, `@megasaver/connectors-shared` patch/minor); code-reviewer + critic (fresh) over `feat/seam-phase-2..HEAD`; then two stacked PRs (phase-2 → base #211 branch; edit-impact → base phase-2).
