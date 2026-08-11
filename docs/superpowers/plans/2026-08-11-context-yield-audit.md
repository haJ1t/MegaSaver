# Context Yield Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** `mega context yield --project <id> [--window 7d] [--json]` reports a bounded freeloader table — injected vs. observed-reuse lower bound vs. yield tier — purely from existing `content-store` + `memory-graph` + `stats` seams. No writes, no LLM, honest lower-bound receipt.

**Architecture:** Pure scorer (`packages/context-pruner/src/yield-audit.ts`) + thin CLI wrapper (`yield-audit/compute.ts` + `commands/context/yield.ts`). No new persistence.

**Tech Stack:** TypeScript strict ESM, Zod strict, Vitest, citty, node:fs, node:child_process execFile, `@megasaver/content-store`, `@megasaver/memory-graph`, `@megasaver/stats`, `@megasaver/policy` (redact).

## Global Constraints

- Read-only join — no new store, no migration.
- Yield = lower bound (`reusedAtLeast / injected`), `honestNote` required.
- Fingerprint = lowercased 3-grams over first 200 chars, `\W+` tokenized, no embeddings.
- Window max 30d, default 7d; ignore-aware (`node_modules`, `.megasaver`, `dist` filtered).
- Table ≤ 50 rows + `+N more`, sorted yield asc, injected desc.
- Pure scorer ≤ 300 LOC, CLI io-injected.
- Zod `strict()` on both return and `--json` output.

---

### Task 1: pure yield scorer in context-pruner

**Files:**
- Create: `packages/context-pruner/src/yield-audit.ts`
- Test: `packages/context-pruner/test/yield-audit.test.ts`

**Interfaces:**
```ts
// packages/context-pruner/src/yield-audit.ts
export const yieldAuditReportSchema: z.ZodType<YieldAuditReport>; // strict
export type YieldAuditReport = z.infer<typeof yieldAuditReportSchema>;
export function computeYieldAudit(input: {
  injected: readonly { id: string; content: string; relatedFiles?: readonly string[] }[];
  evidence: readonly { chunkSetId: string; decisionTraceIds?: readonly string[]; relatedFilesInChunk?: readonly string[] }[];
  readIndexEntries: readonly { path: string; sessionId: string; at: string }[];
  diffAddedLines: readonly string[]; // git diff added corpus
  window: { from: string; to: string };
}): YieldAuditReport;
export function fingerprintMemory(content: string): readonly string[];
export function tierFor(yieldValue: number): "HOT" | "COLD" | "FREELOADER";
```

- [ ] Write failing test `packages/context-pruner/test/yield-audit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computeYieldAudit, fingerprintMemory, tierFor, yieldAuditReportSchema } from "../src/yield-audit.js";
describe("yield audit",()=>{
  it("all freeloaders",()=>{
    const r=computeYieldAudit({injected:[{id:"m1",content:"fix foo"}],evidence:[],readIndexEntries:[],diffAddedLines:[],window:{from:"2026-08-04T00:00:00.000Z",to:"2026-08-11T00:00:00.000Z"}});
    expect(r.rows[0].yield).toBe(0); expect(r.rows[0].tier).toBe("FREELOADER");
    expect(()=>yieldAuditReportSchema.parse(r)).not.toThrow();
  });
  it("caps at 50 rows",()=>{
    const injected=Array.from({length:55},(_,i)=>({id:`m${i}`,content:`c${i}`}));
    const r=computeYieldAudit({injected,evidence:[],readIndexEntries:[],diffAddedLines:[],window:{from:"2026-08-04T00:00:00.000Z",to:"2026-08-11T00:00:00.000Z"}});
    expect(r.rows.length).toBe(50); expect(r.aggregatedRemaining).toBe(5);
  });
  it("strict rejects extra key",()=>{ expect(()=>yieldAuditReportSchema.parse({x:1})).toThrow(); });
  it("fingerprint 3-grams",()=>{ expect(fingerprintMemory("Hello world foo bar").length).toBeGreaterThan(0); });
  it("tier thresholds",()=>{ expect(tierFor(0.6)).toBe("HOT"); expect(tierFor(0.2)).toBe("COLD"); expect(tierFor(0.05)).toBe("FREELOADER"); });
});
```
- [ ] Run `pnpm --filter @megasaver/context-pruner exec vitest run test/yield-audit.test.ts` — FAIL
- [ ] Implement `yield-audit.ts` (≤300 LOC; fingerprint, tierFor, compute with three signals, sorting, capping, honestReceipt)
- [ ] Export from `packages/context-pruner/src/index.ts`
- [ ] Run test — PASS, plus `pnpm --filter @megasaver/context-pruner test` green
- [ ] Commit: `feat(context-pruner): yield audit scorer`

---

### Task 2: CLI thin compute + `mega context yield` command

**Files:**
- Create: `apps/cli/src/yield-audit/compute.ts` (pure re-export or thin wrapper for test seam)
- Create: `apps/cli/src/commands/context/yield.ts`
- Modify: `apps/cli/src/main.ts` (register `context yield`)
- Test: `apps/cli/test/yield-audit/compute.test.ts` (pure) + `apps/cli/test/commands/context-yield.test.ts` (io-injected)

**Interfaces:**
```ts
export function runContextYield(input: {
  cwd: string; home: string; storeFlag?: string;
  projectId?: string; window?: string; json?: boolean;
  stdout: (s:string)=>void; stderr: (s:string)=>void; platform: NodeJS.Platform; now?: ()=>number;
}): Promise<0|1>;
```

- [ ] Write failing tests:
  - pure `compute.test.ts` — same cases as pruner but via CLI wrapper.
  - `context-yield.test.ts` — seed tmp store (`registry.createEntries` 5 memories, 3 chunk-sets, read-index) → `runContextYield({json:true})` parses and yield counts match; no project → exit 1; window >30d → exit 1; empty injected → prints `no memories...` exit 0.
- [ ] Run — FAIL
- [ ] Implement `compute.ts` + `yield.ts` (io-injected: `findProjectByCwd`, `listChunkSets`, `readChunkSet`, `registry.listEntries`, `execFile git diff`, `redact` on paths, bounded 200 added-lines corpus)
- [ ] Register in `main.ts` as `context yield`
- [ ] Run tests — PASS
- [ ] Commit: `feat(cli): mega context yield`

---

### Task 3: changeset, wiki, verify

**Files:** `.changeset/context-yield-audit.md`, `wiki/entities/cli.md`, `wiki/concepts/context-ledger-architecture.md`, `wiki/index.md`, `wiki/log.md`

- [ ] Add changeset (`@megasaver/context-pruner` minor, `@megasaver/cli` minor)
- [ ] Update wiki (new `mega context yield` section, quick-links, log entry `## [2026-08-11] plan | wave-4 1of3`)
- [ ] Run `pnpm verify` — lint+typecheck+test green
- [ ] Smoke: tmp project `registry.createEntries 3` + `saveChunkSet 2` + `read-index` → `mega context yield --json` parses, freeloaders sorted asc
- [ ] Commit: `chore: changeset + wiki for yield audit`
- [ ] Hand off to `code-reviewer` fresh context

---

## Self-review checklist

- [ ] no writes, no LLM, no embeddings
- [ ] honestNote lower-bound present in both human and JSON
- [ ] ignore-filtered file-touch signal
- [ ] strict Zod on report, extra key rejects
- [ ] bounded table 50 + aggregate, deterministic sort
