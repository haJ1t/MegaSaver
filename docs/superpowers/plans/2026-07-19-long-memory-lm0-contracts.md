# Long Memory LM0 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the isolated Long Memory contract and LongMemEval-V2 bridge without changing user-memory writes or agent-facing recall.

**Architecture:** A new `@megasaver/long-memory` package owns strict schemas, an in-memory idempotent store, and a JSONL RPC host. A development-only Python backend implements LongMemEval-V2 `Memory` over one local Node process.

**Tech Stack:** TypeScript strict/ESM, Zod, Vitest, Node `readline`, Python 3.11 standard library.

## Global Constraints

- LM0 changes no CLI, MCP, connector, CoreRegistry, `MemoryEntry`, or Evidence Ledger schema.
- All boundary schemas are `.strict()`; the adapter never accesses a Mega Saver user store.
- The configured benchmark data root is public-only; image paths must be contained by it.
- Every JSONL request yields exactly one JSONL `ok` or typed `invalid_request|not_found|internal` response.
- Run `pnpm verify` and the Python suite before the final commit.

---

### Task 1: Scaffold the package

**Files:**
- Create: `packages/long-memory/{package.json,tsconfig.json,tsconfig.test.json,tsconfig.test-d.json,tsup.config.ts,vitest.config.ts,src/index.ts,test/index.test-d.ts}`
- Modify: `pnpm-workspace.yaml`

**Interfaces:** Produces an ESM package with `build`, `test`, and `typecheck` scripts.

- [ ] **Step 1: Write the failing public-surface test**

```ts
import { expectTypeOf, it } from "vitest";
import * as lm from "../src/index.js";
it("exports LM0", () => {
  expectTypeOf(lm.LONG_MEMORY_PACKAGE).toEqualTypeOf<string>();
});
```

- [ ] **Step 2: Run it red**

Run: `pnpm --filter @megasaver/long-memory test`

Expected: package-filter resolution fails.

- [ ] **Step 3: Add the standard package configuration**

```json
{"name":"@megasaver/long-memory","private":true,"type":"module","exports":{".":{"types":"./dist/index.d.ts","import":"./dist/index.js"}},"scripts":{"build":"tsup","test":"vitest run","typecheck":"tsc -b --noEmit"},"dependencies":{"@megasaver/retrieval":"workspace:*","zod":"^3.24.1"}}
```

Mirror `packages/memory-graph` tsup/Vitest setup with ES2023, source maps, declarations, and clean output.
Set `src/index.ts` to `export const LONG_MEMORY_PACKAGE = "@megasaver/long-memory";`.

- [ ] **Step 4: Run it green**

Run: `pnpm --filter @megasaver/long-memory test`

Expected: public-surface test passes.

- [ ] **Step 5: Commit**

Run: `git add packages/long-memory pnpm-workspace.yaml && git commit -m "build(memory): add long memory package"`

### Task 2: Define strict records and receipt contracts

**Files:**
- Create: `packages/long-memory/src/model.ts`, `packages/long-memory/test/model.test.ts`
- Modify: `packages/long-memory/src/index.ts`

**Interfaces:** Produces `Observation`, `RecallRequest`, `RecallBundle`, `RpcRequest`, and `RpcResponse`.

- [ ] **Step 1: Write failing schema tests**

```ts
expect(observationSchema.parse(validObservation).kind).toBe("state_snapshot");
expect(() => observationSchema.parse({ ...validObservation, extra: true })).toThrow();
expect(() => recallRequestSchema.parse({ task: "x", workspaceKey: "w", tokenBudget: 0 })).toThrow();
```

- [ ] **Step 2: Run it red**

Run: `pnpm --filter @megasaver/long-memory test -- model.test.ts`

Expected: FAIL because `model.ts` is absent.

- [ ] **Step 3: Implement exact schemas**

```ts
export const observationSchema = z.object({
  id: z.string().uuid(), workspaceKey: z.string().min(1),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["state_snapshot", "state_transition"]),
  observedAt: z.string().datetime({ offset: true }), text: z.string().trim().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();
export const recallRequestSchema = z.object({ task: z.string().trim().min(1), workspaceKey: z.string().min(1), tokenBudget: z.number().int().positive() }).strict();
```

Define strict `insert|query` envelopes; bundle items are `{ type:"text", value, observationId }`; every receipt cites the source observation and evidence ids.

- [ ] **Step 4: Run it green and commit**

Run: `pnpm --filter @megasaver/long-memory test -- model.test.ts && pnpm --filter @megasaver/long-memory typecheck && git add packages/long-memory && git commit -m "feat(memory): define long memory contracts"`

Expected: test and typecheck pass.

### Task 3: Implement idempotent store and deterministic recall

**Files:**
- Create: `packages/long-memory/src/store.ts`, `packages/long-memory/test/store.test.ts`
- Modify: `packages/long-memory/src/index.ts`

**Interfaces:** Produces `createInMemoryLongMemoryStore()` with `insert(observation)` and `query(request)`.

- [ ] **Step 1: Write failing behaviour tests**

```ts
const store = createInMemoryLongMemoryStore();
expect(store.insert(snapshot)).toEqual({ inserted: true });
expect(store.insert({ ...snapshot, id: otherId })).toEqual({ inserted: false });
expect(store.query({ task: "billing status", workspaceKey: "w", tokenBudget: 40 }).items).toHaveLength(1);
```

- [ ] **Step 2: Run it red**

Run: `pnpm --filter @megasaver/long-memory test -- store.test.ts`

Expected: FAIL because the factory is absent.

- [ ] **Step 3: Implement and verify**

Store `Map<workspaceKey, Map<sourceDigest, Observation>>`; digest duplicates are idempotent per workspace. Query ranks with `rankBm25`, removes zero-overlap records, and emits rank-ordered items only while `Math.ceil(text.length / 4)` fits budget. Each selected item writes a `state` receipt with evidence ids and token estimate.

Run: `pnpm --filter @megasaver/long-memory test && git add packages/long-memory && git commit -m "feat(memory): add idempotent LM0 store"`

Expected: all package tests pass.

### Task 4: Add the JSONL RPC host

**Files:**
- Create: `packages/long-memory/src/{rpc,stdio}.ts`, `packages/long-memory/test/rpc.test.ts`
- Modify: `packages/long-memory/{src/index.ts,package.json,tsup.config.ts}`

**Interfaces:** Produces `dispatchRpcLine(line, store): string` and `dist/stdio.js`.

- [ ] **Step 1: Write the failing protocol tests**

```ts
expect(JSON.parse(dispatchRpcLine(JSON.stringify({ id: "1", op: "insert", observation }), store))).toMatchObject({ id: "1", ok: true, result: { inserted: true } });
expect(JSON.parse(dispatchRpcLine("{bad", store))).toMatchObject({ ok: false, error: { code: "invalid_request" } });
```

- [ ] **Step 2: Run it red**

Run: `pnpm --filter @megasaver/long-memory test -- rpc.test.ts`

Expected: FAIL because dispatch is absent.

- [ ] **Step 3: Implement and verify**

```ts
export function dispatchRpcLine(line: string, store: LongMemoryStore): string {
  try { return JSON.stringify(handle(rpcRequestSchema.parse(JSON.parse(line)), store)); }
  catch { return JSON.stringify({ id: null, ok: false, error: { code: "invalid_request" } }); }
}
```

Use `node:readline` in `stdio.ts`, output one newline-terminated response per input, and add it as a second tsup entry/bin target.

Run: `pnpm --filter @megasaver/long-memory test && pnpm --filter @megasaver/long-memory build && git add packages/long-memory && git commit -m "feat(memory): expose LM0 JSONL protocol"`

Expected: tests pass and `dist/stdio.js` exists.

### Task 5: Add the public-data LongMemEval adapter

**Files:**
- Create: `benchmarks/longmemeval-v2/{megasaver_memory.py,test_megasaver_memory.py,README.md}`

**Interfaces:** Consumes Task 4; implements official `Memory.insert(trajectory)` and `query(query, query_image=None)`.

- [ ] **Step 1: Write failing Python tests**

```python
memory = MegaSaverLongMemory({"data_root": str(data_root), "node_command": fake_node})
memory.insert({"trajectory_id": "t1", "states": [{"text": "billing status is paid"}]})
assert memory.query("What is the billing status?") == [{"type": "text", "value": "billing status is paid"}]
assert memory._checked_image_path("/tmp/outside.png") is None
```

- [ ] **Step 2: Run it red**

Run: `python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_memory.py`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement, verify, and commit**

Start one injected `subprocess.Popen` JSONL client. Turn each public trajectory state into an observation with `sha256(f"{trajectory_id}:{index}:{text}")`; derive `workspaceKey` from `sha256(data_root.resolve())`; include it on every request. Return non-empty text only; return an image only when its resolved path is inside the configured data root and exists. Document public-data setup, launch, harness command, and artifact retention.

Run: `pnpm verify && python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_memory.py && git add benchmarks/longmemeval-v2 docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md wiki/concepts/long-memory-runtime.md wiki/log.md && git commit -m "feat(bench): add LM0 LongMemEval adapter"`

Expected: repository verification passes and Python reports all tests OK.

## Plan self-review

- Tasks 1–5 cover LM0 contracts, strict boundaries, idempotency, workspace isolation, latency-ready bridge, and public-data adapter.
- LM1–LM3 remain intentionally out of scope and require separately approved specs.
- `Observation`, `RecallRequest`, `RecallBundle`, and RPC names are defined before later tasks consume them.
