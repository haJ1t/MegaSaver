# Phase 3 — Context Pruning Engine (LAMR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Risk: **HIGH** — context packer / evidence-preserving; full chain + `architect` + `critic` + `code-reviewer` + worktree. **Depends on Phase 2** (CodeBlock index) and reads **Phase 1** (memory search); do not start until those land.

**Goal:** Task-aware context selection: score the Phase 2 block index with the multi-factor LAMR model and return a 6–8-block context pack with per-block reasons + an excluded list, via a new `@megasaver/context-pruner` package and `mega context build/explain/audit/export`.

**Architecture:** New package `packages/context-pruner` with `score.ts` (factor model + named weights), `select.ts` (rank → top-N under token budget → dependency closure), `pack.ts` (`ContextPack` type + reason synthesis). Consumes `@megasaver/indexer` blocks, `@megasaver/core` `searchMemoryEntries` (memory relevance), `@megasaver/retrieval` (`rankBm25`/`deriveIntent`) and output-filter's byte-budget logic (`fitBudget`/`effectiveBudget`). No token estimator exists in the codebase — add a `chars/4` token estimate over the byte budget in Task 3 (a precise tokenizer is a later upgrade). Kept separate from `@megasaver/context-gate`. Spec: `docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md`.

**Tech Stack:** TypeScript strict ESM, Vitest, pnpm workspaces, Zod, Citty CLI, `@modelcontextprotocol/sdk`.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/phase3-pruner`, branch `feat/phase3-context-pruning`. Run all commands from the worktree root.

---

### Task 1: Scaffold package + `ContextPack` + factor types

**Files:** New `packages/context-pruner/` (package.json, tsconfig, src/index.ts), `src/pack.ts`; tests `packages/context-pruner/test/pack.test.ts`.

- [ ] **Step 1: Failing test** — `contextPackSchema` validates `{task, included[], excluded[], budget}`; each `ScoredBlock` carries `score`, `reasons[]`, and a `factors` record; reasons are non-empty strings.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — scaffold leaf package. Phase 1 adds `searchMemoryEntries` to `@megasaver/core`; to avoid a core import edge (`decisions/content-store-no-core-edge`), context-pruner accepts it as a **passed-in callback** (mirroring the content-store pattern) rather than importing core directly.
- [ ] **Step 4: Run — expect PASS** + typecheck.
- [ ] **Step 5: Commit** — `feat(context-pruner): ContextPack + ScoredBlock types`.

### Task 2: Scoring model (per-factor, isolated)

**Files:** `src/score.ts`, `src/weights.ts`; test `packages/context-pruner/test/score.test.ts`.

- [ ] **Step 1: Failing test** — each factor isolated: `semanticRelevance` via BM25(task, block doc); `userMentionRelevance` near-decisive when the task names the file/symbol; `testFailureRelevance` for a block in `--failing-tests`; `recentEditRelevance` for `--changed-files`/recent `lastModifiedAt`; `memoryRelevance` when a returned memory cites `filePath`; `stalePenalty`/`noisePenalty` push lockfiles/generated/stale below threshold. Weights are named constants, asserted.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `finalScore` as the documented weighted sum; record each factor's contribution on the block.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(context-pruner): multi-factor LAMR scoring`.

### Task 3: Selection + dependency closure + budget

**Files:** `src/select.ts`; test `packages/context-pruner/test/select.test.ts`.

- [ ] **Step 1: Failing test** — rank → top-N(=8); a high-semantic block pulls in its imported/called helper (Phase 2 `imports`/`calls`) even when the helper scores low; blocks cut for budget are labeled excluded-by-budget vs excluded-by-irrelevance; a named file / failing-test block is **never silently dropped** (forced-include or explicit error — CLAUDE.md no-silent-caps); deterministic tie-break by blockId.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — selection + closure + budget fit: reuse output-filter `fitBudget`/`effectiveBudget` and add a `chars/4` token estimate over it.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(context-pruner): selection, dependency closure, budget`.

### Task 4: Reason synthesis + audit numbers

**Files:** `src/pack.ts` (reasons), `src/audit.ts`; test `packages/context-pruner/test/audit.test.ts`.

- [ ] **Step 1: Failing test** — dominant factor → reason string ("direct semantic evidence", "dependency support", "failing test evidence", "named in task", "cited by … memory"); audit emits filesConsidered/Included/Excluded, blocksConsidered/Included/Excluded, tokensBefore(whole files)/tokensAfter(pack)/percentSaved.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** reason mapping + audit computation (feeds Phase 8).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(context-pruner): reasons + savings audit`.

### Task 5: CLI — context build/explain/audit/export

**Files:** `apps/cli/src/commands/context/{build,explain,audit,export,index}.ts`; register in `main.ts`; test `apps/cli/test/context.test.ts`.

- [ ] **Step 1: Failing test** — `build --task` prints included/excluded with scores+reasons in the roadmap example layout; `--max-tokens`/`--changed-file`(repeat)/`--failing-test`(repeat)/`--limit`/`--json`; `explain` shows factor breakdown; `audit` shows savings; `export --format markdown` emits a pack doc.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — wire `@megasaver/context-pruner` + `@megasaver/indexer` + memory search; pass `searchMemories` in.
- [ ] **Step 4: Run — expect PASS** + CLI smoke capture (DoD §5).
- [ ] **Step 5: Commit** — `feat(cli): mega context build/explain/audit/export`.

### Task 6: MCP tools

**Files:** `packages/mcp-bridge/src/tool-name.ts` (closed enum +4), `server.ts`, `tools/{get-relevant-context,explain-context-selection,get-context-budget-report,get-relevant-code-blocks}.ts`; tests + `server.e2e.test.ts`.

- [ ] **Step 1: Failing test** — `get_relevant_context` returns a `ContextPack`; `get_relevant_code_blocks` is the `included[]` projection; explain/budget tools return their shapes; e2e over stdio.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — mirror existing tool shape; reuse the CLI's composition.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(mcp-bridge): context pruning tools`.

### Task 7: Closeout

- [ ] `pnpm verify` green both OS legs; changesets for `@megasaver/context-pruner` + `@megasaver/cli` + `@megasaver/mcp-bridge`.
- [ ] `architect` + `critic` + `code-reviewer` passes (separate contexts, HIGH risk); verify the pack never silently drops named/failing-test blocks (the core safety invariant).
- [ ] New `wiki/entities/context-pruner.md`; update `wiki/concepts/context-pruning-engine.md` status; append `wiki/log.md`; `superpowers:finishing-a-development-branch`.
- [ ] **Demo check:** run the roadmap "fix the login bug" scenario end-to-end (memory search → index → pack → audit) and capture the before/after token numbers.
