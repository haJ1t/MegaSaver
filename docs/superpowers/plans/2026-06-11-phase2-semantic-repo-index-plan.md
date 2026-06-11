# Phase 2 — Semantic Repo Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Risk: **HIGH** — touches user files at scale; full chain + `architect` + `security-reviewer` + `critic` + worktree mandatory.

**Goal:** A new `@megasaver/indexer` package that parses a repo into typed `CodeBlock`s (TS/JS via the TypeScript compiler API; Markdown/JSON structurally) with `contentHash` incremental rebuild, plus `mega scan` and `mega index build/status/search/show`.

**Architecture:** New package `packages/indexer` with `code-block.ts` (schema), `extract/{extract-ts,extract-md,extract-json}.ts`, `scan.ts` (ignore-aware walk reusing `@megasaver/policy` path safety), `store.ts` (JSON-directory `blocks.jsonl` + `manifest.json`, atomic). Search reuses `@megasaver/retrieval` `rankBm25`. New `CodeBlockId` branded UUID in `@megasaver/shared`. Spec: `docs/superpowers/specs/2026-06-11-phase2-semantic-repo-index-design.md`.

**Tech Stack:** TypeScript strict ESM, Vitest, pnpm workspaces, Zod, `typescript` compiler API, Citty CLI.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/phase2-indexer`, branch `feat/phase2-semantic-index`. Run all commands from the worktree root.

---

### Task 1: Scaffold package + `CodeBlock` schema + `CodeBlockId`

**Files:** New `packages/indexer/` (package.json, tsconfig, src/index.ts), `src/code-block.ts`; `packages/shared/src/ids.ts` (+ `CodeBlockId`); tests `packages/indexer/test/code-block.test.ts`, `packages/shared/test/ids.test.ts`.

- [ ] **Step 1: Failing test** — `codeBlockSchema` validates all `blockType` members + required location/hash fields, rejects bad types; `codeBlockIdSchema` enforces lowercase UUID (match existing id contract).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — scaffold workspace package (mirror an existing leaf package's config; must not import `@megasaver/core` per `decisions/content-store-no-core-edge`); add schema + id.
- [ ] **Step 4: Run — expect PASS** + `pnpm -w typecheck`.
- [ ] **Step 5: Commit** — `feat(indexer,shared): CodeBlock schema + CodeBlockId`.

### Task 2: TS/JS extractor (compiler API)

**Files:** `packages/indexer/src/extract/extract-ts.ts`; test `packages/indexer/test/extract-ts.test.ts` + fixture module.

- [ ] **Step 1: Failing test** — a fixture TS file with a function, class, interface, and a JSX component yields blocks of types function/class/schema/component with correct `name`/`startLine`/`endLine`/`imports`/`exports`/`calls`; `*.test.ts` files classify as `test`; `contentHash` stable across runs.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — walk AST via `typescript`; collect imports/exports/calls; component heuristic (PascalCase + returns JSX); sha256 hash of block text.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(indexer): TypeScript AST block extractor`.

### Task 3: Markdown + JSON extractors

**Files:** `src/extract/extract-md.ts`, `src/extract/extract-json.ts`; tests + fixtures (a `.md`, a `package.json`).

- [ ] **Step 1: Failing test** — Markdown splits on `#`/`##` into `docs` blocks named by heading; JSON yields top-level-key blocks, `package.json` `scripts.*` → `config` blocks named `script:<name>`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the two extractors.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(indexer): markdown + json block extractors`.

### Task 4: Ignore-aware scan (security-critical)

**Files:** `src/scan.ts`; test `packages/indexer/test/scan.test.ts`.

- [ ] **Step 1: Failing test** — walk honors `.gitignore` + always-ignore (`node_modules`/`dist`/`.git`) + `.megaignore`; never traverses outside root; symlink-escape rejected; a fixture `.env`/secret file is excluded; binary/large files skipped with reason.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — reuse `@megasaver/policy` path-safety + redaction posture (both existing) so detected secrets never enter the inventory.
- [ ] **Step 4: Run — expect PASS** + `security-reviewer` pass on this task.
- [ ] **Step 5: Commit** — `feat(indexer): ignore-aware, traversal-safe repo scan`.

### Task 5: Store + incremental build

**Files:** `src/store.ts`, `src/build.ts`; test `packages/indexer/test/build.test.ts`.

- [ ] **Step 1: Failing test** — build persists `blocks.jsonl` + `manifest.json` atomically; touch one file → rebuild reports only that file changed, others `unchanged`; removed file drops its blocks.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — diff per-file `contentHash` against manifest; reuse `atomicWriteFile`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(indexer): atomic store + contentHash incremental build`.

### Task 6: CLI — scan + index build/status/search/show

**Files:** `apps/cli/src/commands/{scan,index/*}.ts`; register in `main.ts`; tests `apps/cli/test/{scan,index}.test.ts`.

- [ ] **Step 1: Failing test** — `mega scan` inventory + `--json`; `index build` counts; `index status` totals-by-type + staleness; `index search` BM25 `score type file:line name`; `index show <id>` metadata + source slice (re-read from disk); `--json` shapes.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — add `@megasaver/indexer` + `@megasaver/retrieval` deps to CLI; wire commands.
- [ ] **Step 4: Run — expect PASS** + CLI smoke capture (DoD §5).
- [ ] **Step 5: Commit** — `feat(cli): mega scan + mega index build/status/search/show`.

### Task 7: Closeout

- [ ] `pnpm verify` green both OS legs; changesets for new `@megasaver/indexer` + `@megasaver/cli` + `@megasaver/shared`.
- [ ] `architect` (design), `security-reviewer` (scan/ignore), `critic` + `code-reviewer` passes (separate contexts).
- [ ] New `wiki/entities/indexer.md`; update `wiki/concepts/semantic-repo-index.md` status; append `wiki/log.md`; `superpowers:finishing-a-development-branch`.
