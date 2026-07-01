# Live Context Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire MegaSaver's already-shipped pack/ranking engines to live session state so tool-output ranking becomes failure-aware and agents can pull a task-scoped context pack.

**Architecture:** Ephemeral session-scoped `SessionFailure` records (exit-code triggered on the registry command path) feed `sessionHints` into `output-filter`, activating the dormant `failureHistoryBoost`; a new `get_task_context` MCP tool chains `deriveIntent → packFor/buildContextPack`; a connector instruction line tells the agent to call it. A determinism/evidence snapshot guard is built first so nothing silently reorders or strips evidence.

**Tech Stack:** TypeScript (ESM, strict), Zod schemas, Vitest, pnpm workspaces. Packages touched: `@megasaver/core`, `@megasaver/context-gate`, `@megasaver/output-filter`, `@megasaver/context-pruner`, `@megasaver/mcp-bridge`, `@megasaver/connectors`, `@megasaver/retrieval`.

**Risk:** HIGH (§12). Work only in worktree `feat/core-live-context-seam`. `pnpm verify` green at every slice boundary. Reviewer + critic in separate contexts before merge.

**Spec:** `docs/superpowers/specs/2026-07-01-live-context-seam-design.md`

**Conventions to honor:** strict alphabetical ordering in mcp-bridge tool registries; `codeBlockSchema.parse()` / `failedAttemptSchema.parse()` fixture style; import id-schemas exactly as `failed-attempt.ts` does (do not invent a path); commit after every green step.

---

## Slice 0 — determinism / evidence guard (build FIRST)

Purpose: lock current pack + ranking behavior with snapshots so Slices 1–3 cannot silently reorder or fold evidence.

### Task 0.1: Pruner determinism snapshot

**Files:**
- Test: `packages/context-pruner/test/determinism.guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { CodeBlock } from "@megasaver/indexer";
import { codeBlockSchema } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { buildContextPack } from "../src/pack.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;
function block(over: Partial<CodeBlock> & { name: string; filePath: string }): CodeBlock {
  n += 1;
  return codeBlockSchema.parse({
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    filePath: over.filePath,
    startLine: over.startLine ?? 1,
    endLine: over.endLine ?? 10,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: `h${n}`,
    imports: over.imports ?? [],
    exports: over.exports ?? [],
    calls: over.calls ?? [],
    calledBy: [],
    keywords: over.keywords ?? [],
  });
}

const blocks = [
  block({ name: "validateToken", filePath: "src/auth.ts", keywords: ["jwt", "auth"] }),
  block({ name: "Navbar", filePath: "src/nav.tsx", keywords: ["ui", "header"] }),
  block({ name: "hashPassword", filePath: "src/crypto.ts", keywords: ["hash", "bcrypt"] }),
];

describe("buildContextPack determinism guard", () => {
  it("returns identical included/excluded ordering across runs", () => {
    const a = buildContextPack({ task: "jwt auth", blocks });
    const b = buildContextPack({ task: "jwt auth", blocks });
    expect(a.included.map((x) => x.block.name)).toEqual(b.included.map((x) => x.block.name));
    expect(a.excluded.map((x) => x.block.name)).toEqual(b.excluded.map((x) => x.block.name));
  });

  it("keeps every excluded block recoverable (metadata present)", () => {
    const pack = buildContextPack({ task: "jwt auth", blocks, limit: 1 });
    for (const ex of pack.excluded) {
      expect(ex.block.filePath.length).toBeGreaterThan(0);
      expect(ex.block.name.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes against current behavior**

Run: `pnpm --filter @megasaver/context-pruner test -- determinism.guard`
Expected: PASS (this is a characterization test of existing behavior). If the `ContextPack.included[]` element shape differs from `{ block: { name, filePath } }`, adjust the accessors to the real `ScoredBlock` shape (see `pack.ts:43-58`) — do NOT change production code.

- [ ] **Step 3: Commit**

```bash
git add packages/context-pruner/test/determinism.guard.test.ts
git commit -m "test(context-pruner): pin pack determinism + excluded recoverability"
```

### Task 0.2: Output-filter ranking determinism + evidence guard

**Files:**
- Test: `packages/output-filter/test/determinism.guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { type SessionHints, applyEngineRanking, scoreChunk } from "../src/rank.js";

const chunk = (text: string) => ({ text, startLine: 1, endLine: 1 });
const hints: SessionHints = { recentMemory: ["useAuthToken"], recentFailures: ["TS2322"] };

describe("engine ranking determinism + evidence guard", () => {
  it("produces identical ranking order across runs", () => {
    const build = () =>
      applyEngineRanking(
        [
          scoreChunk("auth", chunk("Error: useAuthToken failed with TS2322"), hints),
          scoreChunk("auth", chunk("plain unrelated noise"), hints),
          scoreChunk("auth", chunk("second failure near TS2322 line 42"), hints),
        ],
        hints,
      );
    expect(build().map((c) => c.text)).toEqual(build().map((c) => c.text));
  });

  it("does not fold two chunks with distinct error codes", () => {
    const ranked = applyEngineRanking(
      [scoreChunk("e", chunk("boom TS2322"), hints), scoreChunk("e", chunk("boom TS7053"), hints)],
      hints,
    );
    const texts = ranked.map((c) => c.text).join("\n");
    expect(texts).toContain("TS2322");
    expect(texts).toContain("TS7053");
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm --filter @megasaver/output-filter test -- determinism.guard`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/output-filter/test/determinism.guard.test.ts
git commit -m "test(output-filter): pin engine-ranking determinism + evidence"
```

- [ ] **Step 4: Full verify**

Run: `pnpm verify`
Expected: green.

---

## Slice 1 — automatic failure capture (ephemeral, registry path)

### Task 1.1: `SessionFailure` type + schema

**Files:**
- Create: `packages/core/src/session-failure.ts`
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/test/session-failure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { type SessionFailure, sessionFailureSchema } from "../src/session-failure.js";

const valid = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  command: "pnpm test",
  errorOutput: "Expected 200, got 401",
  source: "proxy-classifier",
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("sessionFailureSchema", () => {
  it("parses a valid session failure", () => {
    const parsed: SessionFailure = sessionFailureSchema.parse(valid);
    expect(parsed.command).toBe("pnpm test");
    expect(parsed.source).toBe("proxy-classifier");
  });

  it("rejects an empty command", () => {
    expect(() => sessionFailureSchema.parse({ ...valid, command: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/core test -- session-failure`
Expected: FAIL — cannot resolve `../src/session-failure.js`.

- [ ] **Step 3a: Add the branded id schema to `@megasaver/shared`**

Id schemas live in `@megasaver/shared` (that is where `failedAttemptIdSchema` is defined). Add `sessionFailureIdSchema` next to `failedAttemptIdSchema`, mirroring its exact definition style, and export it from the shared index.

```ts
export const sessionFailureIdSchema = <mirror failedAttemptIdSchema's exact definition, swapping the brand to "SessionFailureId">;
export type SessionFailureId = z.infer<typeof sessionFailureIdSchema>;
```

- [ ] **Step 3b: Implement the schema in core**

```ts
import { projectIdSchema, sessionFailureIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export type { SessionFailureId } from "@megasaver/shared";

export const sessionFailureSchema = z.object({
  id: sessionFailureIdSchema,
  projectId: projectIdSchema,
  sessionId: sessionIdSchema,
  command: z.string().trim().min(1),
  errorOutput: z.string().trim().min(1),
  source: z.literal("proxy-classifier"),
  createdAt: z.string().datetime({ offset: true }),
});
export type SessionFailure = z.infer<typeof sessionFailureSchema>;
```

Add to `packages/core/src/index.ts` (`SessionFailureId` and `sessionFailureIdSchema` are re-exported from `@megasaver/shared` via `session-failure.ts`):

```ts
export { type SessionFailure, type SessionFailureId, sessionFailureSchema } from "./session-failure.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @megasaver/core test -- session-failure`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session-failure.ts packages/core/src/index.ts packages/core/test/session-failure.test.ts
git commit -m "feat(core): add ephemeral SessionFailure schema"
```

### Task 1.2: Registry methods (`createSessionFailure` / `listSessionFailures`, clear on `endSession`)

**Files:**
- Modify: `packages/core/src/registry.ts` (CoreRegistry interface + in-memory impl at ~225-233)
- Modify: `packages/core/src/json-directory-store.ts` (add `sessionFailuresDir`, read/write helpers ~247-291 pattern)
- Modify: `packages/core/src/json-directory-registry.ts` (methods ~174-291 pattern; clear in `endSession`)
- Test: `packages/core/test/session-failure-registry.test.ts`

- [ ] **Step 1: Write the failing test (in-memory registry first)**

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT = "11111111-1111-4111-8111-111111111111" as never;
const SESSION = "22222222-2222-4222-8222-222222222222" as never;
const TS = "2026-07-01T00:00:00.000Z";

function seed() {
  const r = createInMemoryCoreRegistry();
  r.createProject({ id: PROJECT, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
  r.createSession({ id: SESSION, projectId: PROJECT, agentId: "a" as never, riskLevel: "medium", title: null, startedAt: TS, endedAt: null });
  return r;
}

describe("session failure registry", () => {
  it("creates and lists session failures scoped to a session", () => {
    const r = seed();
    r.createSessionFailure({ id: "33333333-3333-4333-8333-333333333333" as never, projectId: PROJECT, sessionId: SESSION, command: "pnpm test", errorOutput: "boom", source: "proxy-classifier", createdAt: TS });
    const list = r.listSessionFailures(PROJECT, SESSION);
    expect(list).toHaveLength(1);
    expect(list[0]?.errorOutput).toBe("boom");
  });

  it("clears session failures on endSession", () => {
    const r = seed();
    r.createSessionFailure({ id: "33333333-3333-4333-8333-333333333334" as never, projectId: PROJECT, sessionId: SESSION, command: "x", errorOutput: "boom", source: "proxy-classifier", createdAt: TS });
    r.endSession(SESSION, { endedAt: TS });
    expect(r.listSessionFailures(PROJECT, SESSION)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/core test -- session-failure-registry`
Expected: FAIL — `createSessionFailure` is not a function.

- [ ] **Step 3: Implement**

In `registry.ts`, add to the `CoreRegistry` interface:

```ts
createSessionFailure(failure: SessionFailure): SessionFailure;
listSessionFailures(projectId: ProjectId, sessionId: SessionId): SessionFailure[];
```

In-memory impl (~225-233): add `const sessionFailures = new Map<SessionId, SessionFailure[]>();` alongside the existing collections; implement `createSessionFailure` (push, keyed by `sessionId`) and `listSessionFailures` (filter by projectId + sessionId, return copy). In the existing `endSession` closure, add `sessionFailures.delete(id);`.

In `json-directory-store.ts`: add `sessionFailuresDir` to `StorePaths` (mirror `failedAttemptsDir`), and `readSessionFailures(paths, sessionId)` / `writeSessionFailures(paths, sessionId, list)` using `join(paths.sessionFailuresDir, sessionId + ".jsonl")` (session-keyed, NOT project-keyed).

In `json-directory-registry.ts`: implement `createSessionFailure` / `listSessionFailures` via `withDirLock` (mirror `updateSession` at ~223-240), and in `endSession` delete the session's `.jsonl` file (ephemeral — cleared on session end).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @megasaver/core test -- session-failure-registry`
Expected: PASS.

- [ ] **Step 5: Add a json-directory-registry parity test**

Append a `describe` block that constructs the JSON-directory registry over a `mkdtemp` store (mirror the existing failed-attempt directory test) and asserts the same create/list/clear behavior persists across a re-open.

- [ ] **Step 6: Run + commit**

Run: `pnpm --filter @megasaver/core test -- session-failure-registry`
Expected: PASS.

```bash
git add packages/core/src/registry.ts packages/core/src/json-directory-store.ts packages/core/src/json-directory-registry.ts packages/core/test/session-failure-registry.test.ts
git commit -m "feat(core): session-scoped failure store, cleared on session end"
```

### Task 1.3: Capture on exit code in `runOutputExecCommand`

**Files:**
- Modify: `packages/context-gate/src/run-command.ts` (`OrchestratorRegistry` port + `runOutputExecCommand`)
- Test: `packages/context-gate/test/session-failure-capture.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runOutputExecCommand } from "../src/run-command.js";
// Reuse the existing run-command test harness in this dir for building a fake registry + spawn.
// The fake registry must implement getSession/getProject AND the new createSessionFailure/listSessionFailures.

describe("session failure capture", () => {
  it("records a SessionFailure when the command exits non-zero", async () => {
    const created: unknown[] = [];
    const registry = makeFakeRegistry({ createSessionFailure: (f) => created.push(f) }); // helper in test
    const res = await runOutputExecCommand({
      registry, storeRoot: STORE, sessionId: SESSION, command: "false", args: [],
      intent: "run tests", originPid: "1", timeoutMs: 5000, maxBytes: 10_000,
      spawn: fakeSpawn({ exitCode: 1, stdout: "boom" }),
    });
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("records nothing when the command exits zero", async () => {
    const created: unknown[] = [];
    const registry = makeFakeRegistry({ createSessionFailure: (f) => created.push(f) });
    await runOutputExecCommand({ /* ...same, */ spawn: fakeSpawn({ exitCode: 0, stdout: "ok" }) });
    expect(created).toHaveLength(0);
  });
});
```

Note: build `makeFakeRegistry` / `fakeSpawn` by copying the existing spawn + registry fakes from `packages/context-gate/test/run-command-dedup.test.ts` (and `run-overlay.test.ts` for the overlay spawn shape). Do not invent a new spawn interface — mirror `RunCommandSpawn` exactly.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test -- session-failure-capture`
Expected: FAIL — no failure recorded (capture not implemented).

- [ ] **Step 3: Implement**

Widen the `OrchestratorRegistry` port in `run-command.ts` to add the write/read methods (the concrete `CoreRegistry` passed in already implements them):

```ts
interface OrchestratorRegistry {
  getSession(id: SessionId): SessionView | null;
  getProject(id: ProjectId): ProjectView | null;
  createSessionFailure(failure: SessionFailure): SessionFailure;
  listSessionFailures(projectId: ProjectId, sessionId: SessionId): SessionFailure[];
}
```

In `runOutputExecCommand`, after `outcome` is available (the `Capture` with `childExitCode` / `terminated`) and after settings resolve gives `settings.projectId`, add:

```ts
if (outcome.childExitCode !== 0 || outcome.terminated !== undefined) {
  input.registry.createSessionFailure({
    id: (input.newId?.() ?? crypto.randomUUID()) as SessionFailureId,
    projectId: settings.projectId,
    sessionId: input.sessionId,
    command: [input.command, ...input.args].join(" "),
    errorOutput: outcome.raw.slice(0, 4000),
    source: "proxy-classifier",
    createdAt: input.now?.() ?? new Date().toISOString(),
  });
}
```

Use the module's existing `newId` / `now` injection convention if present (the input type already carries optional `now` / `newId`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @megasaver/context-gate test -- session-failure-capture`
Expected: PASS.

- [ ] **Step 5: Verify Slice-0 guards still pass, then commit**

Run: `pnpm verify`
Expected: green.

```bash
git add packages/context-gate/src/run-command.ts packages/context-gate/test/session-failure-capture.test.ts
git commit -m "feat(context-gate): capture session failures on non-zero exit"
```

---

## Slice 2 — sessionHints builder + wire into `filterOutput`

### Task 2.1: Build hints and pass them (with `engineRanking: true`)

**Files:**
- Create: `packages/context-gate/src/session-hints.ts`
- Modify: `packages/context-gate/src/run-command.ts` (`runOutputExecCommand` filterOutput call ~230)
- Test: `packages/context-gate/test/session-hints.test.ts`

- [ ] **Step 1: Write the failing test (unit: the builder)**

```ts
import { describe, expect, it } from "vitest";
import { buildSessionHints } from "../src/session-hints.js";

describe("buildSessionHints", () => {
  it("maps session failures into recentFailures", () => {
    const registry = makeFakeRegistry({
      listSessionFailures: () => [
        { id: "a" as never, projectId: P, sessionId: S, command: "x", errorOutput: "TS2322 boom", source: "proxy-classifier", createdAt: TS },
      ],
    });
    const hints = buildSessionHints(registry, P, S);
    expect(hints.recentFailures).toEqual(["TS2322 boom"]);
  });

  it("returns empty recentFailures when none recorded", () => {
    const registry = makeFakeRegistry({ listSessionFailures: () => [] });
    expect(buildSessionHints(registry, P, S).recentFailures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test -- session-hints`
Expected: FAIL — cannot resolve `session-hints.js`.

- [ ] **Step 3: Implement the builder**

```ts
import type { ProjectId, SessionId } from "@megasaver/core";
import type { SessionHints } from "@megasaver/output-filter";

type FailureSource = { listSessionFailures(projectId: ProjectId, sessionId: SessionId): { errorOutput: string }[] };

export function buildSessionHints(registry: FailureSource, projectId: ProjectId, sessionId: SessionId): SessionHints {
  return {
    recentFailures: registry.listSessionFailures(projectId, sessionId).map((f) => f.errorOutput),
  };
}
```

ponytail: only `recentFailures` is populated — that is the keystone. `recentMemory` / `recentFiles` are a cheap follow-up once memory wiring is in reach; leaving them `undefined` is valid per the `SessionHints` optional shape.

- [ ] **Step 4: Wire into `runOutputExecCommand`**

At the `filterOutput` call (~run-command.ts:230), build hints and pass them plus the engine flag:

```ts
const sessionHints = buildSessionHints(input.registry, settings.projectId, input.sessionId);
const result = await filterOutput({
  raw: outcome.raw,
  intent: input.intent,
  mode: settings.mode,
  maxReturnedBytes: settings.maxReturnedBytes,
  source: { kind: "command", command: input.command, args: input.args },
  sessionHints,
  engineRanking: true,
});
```

Keep the existing `source` object shape exactly as it is today; only add `sessionHints` + `engineRanking`.

- [ ] **Step 5: Write the integration test (first-fail raises ranking)**

```ts
import { describe, expect, it } from "vitest";
import { runOutputExecCommand } from "../src/run-command.js";

describe("failure-aware ranking (live)", () => {
  it("ranks the previously-failed area higher on a subsequent call", async () => {
    const registry = makeFakeRegistry(); // real in-memory-ish: stores + lists SessionFailures
    // 1st call: a command fails, referencing "TS2322"
    await runOutputExecCommand({ registry, /* ... */, spawn: fakeSpawn({ exitCode: 1, stdout: "src/x.ts: error TS2322" }) });
    // 2nd call: output mentions both the failing area and noise
    const res = await runOutputExecCommand({ registry, /* ... */, intent: "typescript",
      spawn: fakeSpawn({ exitCode: 0, stdout: "line about TS2322 here\nunrelated noise line" }) });
    expect(res.ok).toBe(true);
    // Assert the chunk mentioning TS2322 outranks the noise chunk in res.result (engine score / order).
  });
});
```

Assert against the ranked output the pipeline returns (chunk order or `engine.failureHistoryBoost > 0` on the TS2322 chunk). Consult `FilterOutputResult` shape for the exact accessor.

- [ ] **Step 6: Run to verify both pass**

Run: `pnpm --filter @megasaver/context-gate test -- session-hints`
Expected: PASS.

- [ ] **Step 7: Full verify + commit**

Run: `pnpm verify`
Expected: green (Slice-0 determinism guards still pass).

```bash
git add packages/context-gate/src/session-hints.ts packages/context-gate/src/run-command.ts packages/context-gate/test/session-hints.test.ts
git commit -m "feat(context-gate): feed live session failures into output ranking"
```

---

## Slice 3 — proactive seam: `get_task_context` MCP tool

### Task 3.1: Register + implement `get_task_context`

**Files:**
- Create: `packages/mcp-bridge/src/tools/get-task-context.ts`
- Modify: `packages/mcp-bridge/src/tool-name.ts` (add `get_task_context` to `mcpToolNameSchema` enum, alphabetical)
- Modify: `packages/mcp-bridge/src/server.ts` (import; `TOOL_DEFS` entry; dispatch case — all alphabetical, after `get_context_budget_report`)
- Test: `packages/mcp-bridge/test/tools/get-task-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleGetTaskContext } from "../../src/tools/get-task-context.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-07-01T00:00:00.000Z";

describe("get_task_context", () => {
  it("returns a task-scoped pack with included blocks", async () => {
    const store = mkdtempSync(join(tmpdir(), "task-ctx-store-"));
    const repo = mkdtempSync(join(tmpdir(), "task-ctx-repo-"));
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "auth.ts"), "export function validateToken(t: string) { return t.length > 0; }");
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = createInMemoryCoreRegistry();
    registry.createProject({ id: PROJECT_ID as never, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS });
    const result = await handleGetTaskContext({ registry, storeRoot: store }, { projectId: PROJECT_ID, task: "fix validateToken" });
    expect(result.task).toBe("fix validateToken");
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("rejects a missing task", async () => {
    const registry = createInMemoryCoreRegistry();
    await expect(handleGetTaskContext({ registry, storeRoot: "/tmp" }, { projectId: PROJECT_ID })).rejects.toThrow(McpBridgeError);
  });

  it("rejects an unknown project", async () => {
    const registry = createInMemoryCoreRegistry();
    await expect(handleGetTaskContext({ registry, storeRoot: "/tmp" }, { projectId: "99999999-9999-4999-8999-999999999999", task: "x" })).rejects.toThrow(/project not found/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test -- get-task-context`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the handler (reuse `packFor` + `deriveIntent`)**

```ts
import { deriveIntent } from "@megasaver/retrieval";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { packFor, type ContextToolEnv } from "./context-pruning.js"; // reuse existing helper

const argsSchema = z.object({ projectId: z.string().uuid(), task: z.string().trim().min(1) });

export type GetTaskContextEnv = ContextToolEnv; // { registry, storeRoot, embedFn? }
export type TaskContextResult = { task: string; context: string; blocks: readonly unknown[] };

export async function handleGetTaskContext(env: GetTaskContextEnv, args: unknown): Promise<TaskContextResult> {
  const parsed = argsSchema.safeParse(args);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  const intent = deriveIntent({ intent: parsed.data.task });
  const pack = await packFor(env, { projectId: parsed.data.projectId, task: intent.query });
  return { task: parsed.data.task, context: renderPack(pack), blocks: pack.included };
}
```

Match `packFor`'s real signature and return shape (see `context-pruning.ts:60-110`); reuse its project-not-found error path (that is where the `/project not found/` rejection comes from). `renderPack` = the same textual rendering `handleGetRelevantContext` already uses — reuse it, do not write a new renderer.

- [ ] **Step 4: Register the tool in all three places (strict alphabetical)**

1. `tool-name.ts` — add `"get_task_context"` to the `mcpToolNameSchema` z.enum, alphabetical.
2. `server.ts` TOOL_DEFS — add `{ id: "get_task_context", description: "Build a task-aware context pack from the project index and memories.", inputSchema: <match a neighbor's schema style> }`, after `get_context_budget_report`.
3. `server.ts` dispatch switch — add `case "get_task_context": return handleGetTaskContext({ registry: deps.registry, storeRoot: deps.storeRoot }, args);` after the `get_context_budget_report` case; add the import.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test -- get-task-context`
Expected: PASS.

- [ ] **Step 6: Verify tool-registry consistency tests pass**

Run: `pnpm --filter @megasaver/mcp-bridge test`
Expected: green — the existing tool-name / TOOL_DEFS parity tests confirm all three registries agree.

- [ ] **Step 7: Full verify + commit**

Run: `pnpm verify`
Expected: green.

```bash
git add packages/mcp-bridge/src/tools/get-task-context.ts packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/src/server.ts packages/mcp-bridge/test/tools/get-task-context.test.ts
git commit -m "feat(mcp-bridge): add get_task_context tool (deriveIntent + packFor)"
```

---

## Slice 4 — injection bootstrap (connector instruction line)

### Task 4.1: Instruct the agent to call `get_task_context` at task start

**Files:**
- Modify: `packages/connectors/shared/src/context-gate-block.ts` (`renderContextGateBlockText`, before `MEGA_SAVER_CG_BLOCK_END`)
- Test: `packages/connectors/shared/test/context-gate-block.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// In the existing describe("renderContextGateBlock", ...):
it("instructs the agent to call get_task_context when enabled", () => {
  const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
  expect(block).toContain("get_task_context");
});

it("omits the instruction entirely when token saver is disabled", () => {
  const block = renderContextGateBlock(ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false }));
  expect(block).toBe("");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @megasaver/connectors test -- context-gate-block`
Expected: FAIL — block does not contain `get_task_context`.

- [ ] **Step 3: Implement**

In `renderContextGateBlockText()`, add one entry to the string array immediately before `MEGA_SAVER_CG_BLOCK_END`:

```ts
    `Max returned bytes: ${fields.maxReturnedBytes}`,
    "At task start, call get_task_context({ projectId, task }) to fetch a task-scoped context pack before reading files.",
    MEGA_SAVER_CG_BLOCK_END,
```

The `enabled !== true` gate already returns `""`, so the disabled-case test passes without further change.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @megasaver/connectors test -- context-gate-block`
Expected: PASS.

- [ ] **Step 5: Full verify + commit**

Run: `pnpm verify`
Expected: green.

```bash
git add packages/connectors/shared/src/context-gate-block.ts packages/connectors/shared/test/context-gate-block.test.ts
git commit -m "feat(connectors): instruct agents to call get_task_context at task start"
```

---

## Final gate (before review)

- [ ] `pnpm verify` green (lint + typecheck + all tests).
- [ ] `pnpm conventions:check` green (no agent-file drift; if `CLAUDE.md` conventions were untouched, this is a no-op).
- [ ] Feature smoke evidence: start the bridge, call `get_task_context` on this repo, capture the returned pack (`percentSaved` in `budget`); run a failing command through `runOutputExecCommand`, then a second command, and capture the ranking shift.
- [ ] Add a changeset (`.changeset/live-context-seam.md`) — public API changed in `core` (SessionFailure + registry methods) and `mcp-bridge` (new tool).
- [ ] Reviewer pass: `code-reviewer` (separate context). HIGH risk → also `critic` adversarial (separate context).
- [ ] Verifier pass (`omc:verify`) — evidence-based.

## Deferred (not in this plan)

Slice 5 (impact-pack on edit), overlay/registry-less command path capture, `read.ts` hints, semantic-type scorer weights, non-TS FQN, `recentMemory`/`recentFiles`/`projectConventions` hint sources, stats A/B telemetry dashboard. Each revisited on measured need.
