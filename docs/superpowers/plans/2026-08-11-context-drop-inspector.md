# Context Drop Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Deterministic drop report for any query/budget — kept vs dropped blocks with reason codes and restore pointers.

**Architecture:** Pure `inspectPack` in `@megasaver/context-pruner` + CLI loader that replays retrieval → scorer → rank → fit and renders the report.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, `@megasaver/context-pruner`, `@megasaver/context-gate`, `@megasaver/retrieval`, `@megasaver/indexer`, `@megasaver/policy`, `@megasaver/output-filter`.

## Global Constraints

- Deterministic: score desc → blockId lex → filePath lex; config hash over scorer JSON (sorted keys, no whitespace variance).
- Read-only: no index/memory/policy writes; report carries `scorerConfigHash`.
- Token budget via `modeToBudget` / `estimateTokens` only.
- Redaction at render time, never in the pure report.
- Conventional commits ≤ 50 chars.

---

### Task 1: pure inspectPack in context-pruner

**Files:** `packages/context-pruner/src/inspect.ts` (new), `packages/context-pruner/test/inspect.test.ts` (new)

**Interfaces:**
```ts
export type DropReason = "budget"|"rank"|"policy"|"dedup"|"stale";
export type DropReport = { version:1; query:string; budget:number; kept:KeptBlock[]; dropped:DroppedBlock[]; counters:{totalBlocks:number; totalTokens:number; keptTokens:number; droppedTokens:number; budgetUtilization:number}; scorerConfigHash:string };
export function inspectPack(input:{ query:string; candidates:Block[]; scored:ScoredBlock[]; ranked:RankedBlock[]; kept:RankedBlock[]; dropped:RankedBlock[]; budget:number; scorerConfig:unknown }): DropReport;
export function hashScorerConfig(cfg: unknown): string; // sha256 of canonical JSON
```

- [ ] Write failing test: deterministic order (shuffle scored → same kept/dropped order), budget reason (budget 100 → lowest-score dropped with reason budget), dedup (duplicate blockId → second is dedup), counters sum, hash stability.
- [ ] Run — FAIL
- [ ] Implement `inspect.ts` (sort, assign reason, count tokens via injected counter in test, canonical JSON hash)
- [ ] Run — PASS
- [ ] Commit: `feat(context-pruner): inspectPack drop report`

---

### Task 2: CLI loader + renderer

**Files:** `apps/cli/src/context/inspect.ts` (new), `apps/cli/test/context/inspect.test.ts` (new)

**Interfaces:**
```ts
export type RunContextWhyInput = { query:string; budget?:number; sessionId?:string; last?:boolean; json?:boolean; cwd:string; home:string; storeFlag?:string; stdout:(s:string)=>void; stderr:(s:string)=>void };
export function runContextWhy(input: RunContextWhyInput): Promise<0|1>;
export function renderDropReport(report: DropReport): string;
```

- [ ] Write failing test: with a fake index (in-memory blocks) and budget 200, kept + dropped cover all candidates; --json parses; last without audit warns but succeeds.
- [ ] Run — FAIL
- [ ] Implement: load index meta (`packages/indexer` sidecar), call retrieval BM25, scorer, gate rank/fit, call `inspectPack`, render text (`kept (N) / dropped (M, budget/rank/policy)`) + restore pointers.
- [ ] Run — PASS
- [ ] Commit: `feat(cli): context why loader`

---

### Task 3: `mega context why` command

**Files:** `apps/cli/src/commands/context/why.ts` (new), `apps/cli/src/commands/context/index.ts` (wire), `apps/cli/test/commands/context-why.test.ts` (new)

- [ ] Write failing tests: `mega context why "q"` prints `kept`/`dropped`; `--budget 10` drops more; `--json` shape; unknown session → exit 1.
- [ ] Run — FAIL
- [ ] Implement citty command, register under `context` parent.
- [ ] Run + dependency-graph guard — PASS
- [ ] Commit: `feat(cli): mega context why`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/context-pruner` minor, `@megasaver/cli` minor
- [ ] Wiki: `wiki/concepts/context-pruning-engine.md` why section
- [ ] `pnpm verify` green; smoke: `mega index` → `mega context why "auth" --json` shows kept/dropped
- [ ] Commit: `chore: changeset + wiki for drop inspector`
- [ ] Hand off to `code-reviewer`
