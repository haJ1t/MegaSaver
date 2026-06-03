# BB8 — MCP bridge real implementation + `mega mcp` CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **RISK: CRITICAL** (AA1 §15 row BB8, `CLAUDE.md` §12). The full
> CRITICAL chain is MANDATORY and is NOT a step in this plan — it
> wraps it: `architect` design memo (HIGH) → `critic` adversarial
> pass → `tracer` spawn-path hypotheses → `security-reviewer`
> PR-comment sign-off → `code-reviewer` → `verifier` evidence
> bundle → **manual user confirmation: reply `confirm BB8 merge`
> verbatim** (AA1 §16). **NO `autopilot` / `ralph` / unsupervised
> loops at any point. NO log compression.** Author ≠ reviewer:
> three distinct fresh-context session UUIDs (architect, critic,
> code-reviewer) recorded in the verifier bundle (AA1 §16).

**Goal:** Replace the v0.3 `not_implemented` mcp-bridge placeholder with a real `@megasaver/mcp-bridge` MCP server over stdio exposing four policy-gated, redaction-pipelined tools, and ship the `mega mcp {install,repair,status,uninstall}` CLI.

**Architecture:** `createBridge(config)` (API preserved, AA1 §2c) builds an MCP `Server` from `@modelcontextprotocol/sdk` wired to a `StdioServerTransport`. Four tool handlers are thin adapters over the BB7 context-gate orchestrator in `@megasaver/core` (`runOutputPipeline` for read-file, BB7b's `runOutputExecCommand` for run-command, `fetchChunk` for fetch-chunk) plus direct `@megasaver/content-store` + registry reads for recall. The `tools/call` dispatcher rejects unknown names with `tool_not_found`. A `McpSetupOps` facade (BB8-owned) drives `mega mcp` (CLI) and the GUI AgentSetupDoctor (BB11) off one shared status aggregation; `mega mcp` mirrors `connector/sync.ts` for idempotent agent-config install.

**Tech Stack:** TypeScript strict ESM, Zod boundary, Vitest, Citty CLI, `@modelcontextprotocol/sdk` (NEW dep), pnpm workspace + Turborepo.

---

## Preconditions (verify before Task 1 — do NOT start otherwise)

- [ ] **BB7b merged.** `packages/core/src/context-gate/run-command.ts`
  exists on `main` and exports `runOutputExecCommand` (the
  authoritative name + union — `bb7b-output-exec-plan.md` Task 1;
  see Task 4 import note). AA1 §14 BB8 "Depends on: …, BB7a, BB7b".
  As of #75 the branch ships BB7a only — `run-command.ts` is
  absent. **If `run-command.ts` does not exist, STOP and escalate;
  BB8 cannot land.**
- [ ] BB1–BB7a merged: `@megasaver/{shared,core,policy,content-store,output-filter,retrieval,stats}` all build; `packages/core/src/context-gate.ts` barrel exports `runOutputPipeline`, `fetchChunk`, `resolveEffectiveSettings`.
- [ ] Confirm the BB7b orchestrator export at merge time matches `bb7b-output-exec-plan.md` Task 1: `runOutputExecCommand(input: RunOutputExecCommandInput): Promise<RunOutputExecCommandResult>` where the result union is `{ ok: true; result: ExecResult } | { ok: false; reason: "session_not_found" } | { ok: false; reason: "command_denied"; code: PolicyDenyCode } | { ok: false; reason: "command_failed"; detail: string } | { ok: false; reason: "store_write_failed"; detail: string }`. Task 4 binds to exactly this.

## File Structure

**Created:**
- `packages/mcp-bridge/src/tool-name.ts` — `mcpToolNameSchema` + `McpToolName` (AA1 §8a).
- `packages/mcp-bridge/src/tools/fetch-chunk.ts` — `mega_fetch_chunk` handler (pure read).
- `packages/mcp-bridge/src/tools/read-file.ts` — `mega_read_file` handler (two-gate + filter via core).
- `packages/mcp-bridge/src/tools/recall.ts` — `mega_recall` handler (memory + chunkSets).
- `packages/mcp-bridge/src/tools/run-command.ts` — `mega_run_command` handler (spawn orchestrator + policy).
- `packages/mcp-bridge/src/server.ts` — stdio server wiring + `tools/call` dispatch + `tool_not_found`.
- `packages/mcp-bridge/src/setup/agent-ids.ts` — `KnownAgentId` (mirrors CLI `KnownTargetId`).
- `packages/mcp-bridge/src/setup/detect-agent.ts` — resolve agent MCP config path + presence check.
- `packages/mcp-bridge/src/setup/install.ts` — idempotent MCP-snippet install/uninstall.
- `packages/mcp-bridge/src/setup/repair.ts` — install + connector-sync handle.
- `packages/mcp-bridge/src/setup/restart-hint.ts` — per-agent `restartHint` (F6; BB8-owned, BB11 surfaces).
- `packages/mcp-bridge/src/setup/status.ts` — `aggregateMcpStatus` + `McpStatusResult`/`McpAgentStatus` (F4 `connectorSynced`); ONE source for CLI + GUI.
- `packages/mcp-bridge/src/setup/setup-ops.ts` — `buildMcpSetupOps(deps): McpSetupOps` facade (F2; BB8-owned, BB11 consumes).
- `packages/mcp-bridge/test/tool-name.test-d.ts` — `McpToolName` 4-member tuple pin.
- `packages/mcp-bridge/test/setup/setup-ops.test.ts` — facade status/install/repair/uninstall (F2/F4/F6).
- `apps/cli/src/commands/mcp/install.ts` — `mega mcp install`.
- `apps/cli/src/commands/mcp/repair.ts` — `mega mcp repair`.
- `apps/cli/src/commands/mcp/status.ts` — `mega mcp status`.
- `apps/cli/src/commands/mcp/uninstall.ts` — `mega mcp uninstall`.
- `apps/cli/src/commands/mcp/connector-synced.ts` — CLI-side `connectorSynced` resolver (reads connector file + `parseBlock`).
- `apps/cli/src/commands/mcp/index.ts` — `mega mcp` Citty parent.
- `apps/cli/test/mcp/install.test.ts`, `apps/cli/test/mcp/status.test.ts` — CLI e2e.
- `packages/mcp-bridge/test/server.e2e.test.ts` — stdio round-trip acceptance.
- `packages/mcp-bridge/test/run-command.recursive.test.ts` — recursive + policy-denied + unknown-tool.

**Modified (replace):**
- `packages/mcp-bridge/src/bridge.ts` — real `createBridge` (was reject-stub).
- `packages/mcp-bridge/src/errors.ts` — `McpBridgeErrorCode` 1 → 16 members.
- `packages/mcp-bridge/src/index.ts` — barrel adds `tool-name`, `server`, setup facade + status.
- `packages/mcp-bridge/test/bridge.test.ts` — drop `not_implemented` expectations; assert real lifecycle.
- `packages/mcp-bridge/test/errors.test-d.ts` — rewrite to 16-member tuple pin.
- `packages/mcp-bridge/package.json` — add deps (`@modelcontextprotocol/sdk`, workspace packages). The `connectorSynced` block-presence check is an INJECTED resolver supplied by the caller (CLI uses `@megasaver/connectors-shared` `parseBlock`), so mcp-bridge does NOT depend on connectors-shared (keeps the dependency arrow clean — AA1 §3, §2c DI).
- `apps/cli/src/main.ts` — register `mcpCommand`.
- `apps/cli/src/errors.ts` — add `unknownTargetMessage` (or reuse `invalidTargetMessage`).
- `apps/cli/test/json-failure-paths.test.ts` — add `mcp install`/`uninstall` invalid-target rows.
- `apps/gui/bridge/server.ts` — wire `buildMcpSetupOps(...)` as the default `mcpOps` (F3; replaces BB11 stub).

---

## Task 0: Dependencies + barrel scaffold

**Files:**
- Modify: `packages/mcp-bridge/package.json`
- Modify: `packages/mcp-bridge/src/index.ts`

- [ ] **Step 1: Add dependencies**

Replace the `dependencies` block in `packages/mcp-bridge/package.json`:

```json
  "dependencies": {
    "@megasaver/content-store": "workspace:*",
    "@megasaver/core": "workspace:*",
    "@megasaver/output-filter": "workspace:*",
    "@megasaver/policy": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.24.1"
  }
```

Also update the `description` field:

```json
  "description": "Mega Saver MCP server bridge — stdio transport, four context-gate tools.",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; `@modelcontextprotocol/sdk` resolved under `node_modules/@modelcontextprotocol/sdk`. No peer-dep errors.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-bridge/package.json pnpm-lock.yaml
git commit -m "build: add mcp-bridge runtime deps (sdk + core)"
```

---

## Task 1: Widen `McpBridgeErrorCode` 1 → 16 + rewrite pin

**Files:**
- Modify: `packages/mcp-bridge/src/errors.ts`
- Modify (rewrite): `packages/mcp-bridge/test/errors.test-d.ts`

- [ ] **Step 1: Rewrite the failing tuple pin**

Replace the entire contents of `packages/mcp-bridge/test/errors.test-d.ts`:

```ts
import { describe, it } from "vitest";
import { type McpBridgeErrorCode, mcpBridgeErrorCodeSchema } from "../src/errors.js";

describe("McpBridgeErrorCode type regression", () => {
  it("each member is a valid McpBridgeErrorCode", () => {
    const _a: McpBridgeErrorCode = "command_denied";
    const _b: McpBridgeErrorCode = "resource_not_found";
    const _c: McpBridgeErrorCode = "tool_not_found";
    void _a;
    void _b;
    void _c;
  });

  it("removed v0.3 member is no longer assignable", () => {
    // @ts-expect-error not_implemented was removed in BB8 (AA1 §8b)
    const _bad: McpBridgeErrorCode = "not_implemented";
    void _bad;
  });

  it("arbitrary string is not assignable to McpBridgeErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable
    const _bad: McpBridgeErrorCode = "boom" as string;
    void _bad;
  });

  it("schema.options spreads into McpBridgeErrorCode[]", () => {
    const arr: McpBridgeErrorCode[] = [...mcpBridgeErrorCodeSchema.options];
    void arr;
  });

  it("schema.options preserves the 16-member alphabetic order (AA1 §8b)", () => {
    const _t: readonly [
      "auth_failed",
      "command_denied",
      "content_store_miss",
      "intent_required",
      "max_bytes_exceeded",
      "path_denied",
      "policy_load_failed",
      "redaction_failed",
      "resource_not_found",
      "session_not_found",
      "store_write_failed",
      "tool_invocation_failed",
      "tool_not_found",
      "transport_closed",
      "transport_failed",
      "validation_failed",
    ] = mcpBridgeErrorCodeSchema.options;
    void _t;
  });
});
```

- [ ] **Step 2: Run the pin — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: FAIL — `errors.test-d.ts` references the 16-tuple but `errors.ts` still has `["not_implemented"]`, so the `readonly [...]` assignment errors and the `@ts-expect-error` on `not_implemented` is unused.

- [ ] **Step 3: Widen the enum**

Replace the entire contents of `packages/mcp-bridge/src/errors.ts`:

```ts
import { z } from "zod";

// Order: alphabetic (AA1 §8b, §17). 16 members. The v0.3
// `not_implemented` member is removed — every entrypoint now has
// a real implementation (CLAUDE.md §13: no pre-1.0 shims).
// `resource_not_found` honours HH §7 reservation (F-MAJ-9);
// `path_denied` added per F-CRIT-2.
export const mcpBridgeErrorCodeSchema = z.enum([
  "auth_failed",
  "command_denied",
  "content_store_miss",
  "intent_required",
  "max_bytes_exceeded",
  "path_denied",
  "policy_load_failed",
  "redaction_failed",
  "resource_not_found",
  "session_not_found",
  "store_write_failed",
  "tool_invocation_failed",
  "tool_not_found",
  "transport_closed",
  "transport_failed",
  "validation_failed",
]);

export type McpBridgeErrorCode = z.infer<typeof mcpBridgeErrorCodeSchema>;

export class McpBridgeError extends Error {
  readonly code: McpBridgeErrorCode;
  readonly details: { reason: string } | undefined;

  constructor(
    code: McpBridgeErrorCode,
    message: string,
    options?: { cause?: unknown; details?: { reason: string } },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "McpBridgeError";
    this.code = mcpBridgeErrorCodeSchema.parse(code);
    this.details = options?.details;
  }
}
```

- [ ] **Step 4: Run the pin — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: PASS (no type errors; all `@ts-expect-error` satisfied).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/errors.ts packages/mcp-bridge/test/errors.test-d.ts
git commit -m "feat(mcp-bridge): widen McpBridgeErrorCode to 16 members"
```

---

## Task 2: `McpToolName` enum + tuple pin

**Files:**
- Create: `packages/mcp-bridge/src/tool-name.ts`
- Create: `packages/mcp-bridge/test/tool-name.test-d.ts`
- Modify: `packages/mcp-bridge/src/index.ts`

- [ ] **Step 1: Write the failing tuple pin**

Create `packages/mcp-bridge/test/tool-name.test-d.ts`:

```ts
import { describe, it } from "vitest";
import { type McpToolName, mcpToolNameSchema } from "../src/tool-name.js";

describe("McpToolName type regression", () => {
  it("each member is a valid McpToolName", () => {
    const _a: McpToolName = "mega_fetch_chunk";
    const _b: McpToolName = "mega_read_file";
    const _c: McpToolName = "mega_recall";
    const _d: McpToolName = "mega_run_command";
    void _a;
    void _b;
    void _c;
    void _d;
  });

  it("non-member string is not assignable to McpToolName", () => {
    // @ts-expect-error arbitrary string is not assignable
    const _bad: McpToolName = "mega_delete" as string;
    void _bad;
  });

  it("schema.options spreads into McpToolName[]", () => {
    const arr: McpToolName[] = [...mcpToolNameSchema.options];
    void arr;
  });

  it("schema.options preserves the 4-member alphabetic order (AA1 §8a)", () => {
    const _t: readonly [
      "mega_fetch_chunk",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
    ] = mcpToolNameSchema.options;
    void _t;
  });
});
```

- [ ] **Step 2: Run the pin — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: FAIL — `../src/tool-name.js` does not exist ("Cannot find module").

- [ ] **Step 3: Create the enum**

Create `packages/mcp-bridge/src/tool-name.ts`:

```ts
import { z } from "zod";

// Order: alphabetic (AA1 §8a, §17). Closed set — the four MCP
// tools the Mega Saver bridge exposes over the wire.
export const mcpToolNameSchema = z.enum([
  "mega_fetch_chunk",
  "mega_read_file",
  "mega_recall",
  "mega_run_command",
]);

export type McpToolName = z.infer<typeof mcpToolNameSchema>;
```

- [ ] **Step 4: Add to barrel**

Replace `packages/mcp-bridge/src/index.ts`:

```ts
export * from "./bridge.js";
export * from "./errors.js";
export * from "./tool-name.js";
export * from "./transport.js";
```

- [ ] **Step 5: Run the pin — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/src/index.ts packages/mcp-bridge/test/tool-name.test-d.ts
git commit -m "feat(mcp-bridge): add McpToolName closed enum + pin"
```

---

## Task 3: `mega_fetch_chunk` handler (pure read)

**Files:**
- Create: `packages/mcp-bridge/src/tools/fetch-chunk.ts`
- Test: `packages/mcp-bridge/test/tools/fetch-chunk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-bridge/test/tools/fetch-chunk.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleFetchChunk } from "../../src/tools/fetch-chunk.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

async function seedChunkSet(store: string, chunkSetId: string): Promise<void> {
  const dir = join(store, "content", PROJECT_ID, SESSION_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${chunkSetId}.json`),
    JSON.stringify({
      chunkSetId,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: "2026-05-13T00:00:00.000Z",
      source: { kind: "file", path: "log.txt" },
      rawBytes: 10,
      redacted: true,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
    }),
  );
}

describe("handleFetchChunk", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-fetch-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("returns the chunk on a hit", async () => {
    await seedChunkSet(store, "cs-1");
    const result = await handleFetchChunk(
      { storeRoot: store },
      { chunkSetId: "cs-1", chunkId: "0" },
    );
    expect(result).toEqual({
      chunkSetId: "cs-1",
      chunkId: "0",
      chunk: { id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" },
    });
  });

  it("throws content_store_miss on unknown chunkSetId", async () => {
    await expect(
      handleFetchChunk({ storeRoot: store }, { chunkSetId: "nope", chunkId: "0" }),
    ).rejects.toMatchObject({ name: "McpBridgeError", code: "content_store_miss" });
  });

  it("throws content_store_miss on unknown chunkId within a found set", async () => {
    await seedChunkSet(store, "cs-1");
    await expect(
      handleFetchChunk({ storeRoot: store }, { chunkSetId: "cs-1", chunkId: "99" }),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("throws validation_failed on malformed args", async () => {
    await expect(
      handleFetchChunk({ storeRoot: store }, { chunkSetId: "", chunkId: "0" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test fetch-chunk`
Expected: FAIL — "Cannot find module '../../src/tools/fetch-chunk.js'".

- [ ] **Step 3: Implement the handler**

Create `packages/mcp-bridge/src/tools/fetch-chunk.ts`:

```ts
import { type Chunk, fetchChunk } from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type FetchChunkToolEnv = { storeRoot: string };

const fetchChunkInputSchema = z
  .object({
    chunkSetId: z.string().min(1),
    chunkId: z.string().min(1),
    around: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FetchChunkToolResult = {
  chunkSetId: string;
  chunkId: string;
  chunk: Chunk;
};

export async function handleFetchChunk(
  env: FetchChunkToolEnv,
  rawArgs: unknown,
): Promise<FetchChunkToolResult> {
  const parsed = fetchChunkInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { chunkSetId, chunkId } = parsed.data;

  const outcome = await fetchChunk({ storeRoot: env.storeRoot, chunkSetId, chunkId });
  if (!outcome.ok) {
    if (outcome.reason === "store_corrupt") {
      throw new McpBridgeError("content_store_miss", `chunk store corrupt: ${outcome.detail}`);
    }
    throw new McpBridgeError(
      "content_store_miss",
      outcome.reason === "chunk_set_not_found"
        ? `chunk set not found: ${chunkSetId}`
        : `chunk not found: ${chunkId} in ${chunkSetId}`,
    );
  }
  return { chunkSetId, chunkId, chunk: outcome.chunk };
}
```

> Note: `Chunk` and `fetchChunk` re-export from `@megasaver/core`
> via the `context-gate.ts` barrel (BB7a). `fetchChunk` returns
> the BB7a `FetchChunkResult` discriminated union. `around` is
> accepted in the schema (AA1 §8a) but not yet consumed — BB7a's
> `fetchChunk` returns a single chunk; widening to a window is a
> post-BB8 follow-up. Accepting-and-ignoring an optional input is
> not a half-implementation; it is forward-compatible schema.

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test fetch-chunk`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/fetch-chunk.ts packages/mcp-bridge/test/tools/fetch-chunk.test.ts
git commit -m "feat(mcp-bridge): add mega_fetch_chunk tool handler"
```

---

## Task 4: `mega_read_file` + `mega_run_command` handlers

**Files:**
- Create: `packages/mcp-bridge/src/tools/read-file.ts`
- Create: `packages/mcp-bridge/src/tools/run-command.ts`
- Test: `packages/mcp-bridge/test/tools/read-file.test.ts`
- Test: `packages/mcp-bridge/test/tools/run-command.test.ts`

> **IMPORT BINDING NOTE (read first).** `read-file` calls the
> BB7a `runOutputPipeline` (confirmed export). `run-command`
> calls the **BB7b** spawn orchestrator. The authoritative
> definition is the BB7b plan
> (`docs/superpowers/plans/2026-05-13-bb7b-output-exec-plan.md`,
> Task 1): the export is **`runOutputExecCommand`** from
> `packages/core/src/context-gate/run-command.ts` (re-exported by
> the `context-gate.ts` barrel). Its input
> `RunOutputExecCommandInput` requires `{ registry, storeRoot,
> sessionId, intent, command, args, originPid, timeoutMs,
> maxCaptureBytes }` plus optional `{ now, newId, spawn }`. Its
> result `RunOutputExecCommandResult` is:
> `{ ok: true; result: ExecResult }`
> `| { ok: false; reason: "session_not_found" }`
> `| { ok: false; reason: "command_denied"; code: PolicyDenyCode }`
> `| { ok: false; reason: "command_failed"; detail: string }`
> `| { ok: false; reason: "store_write_failed"; detail: string }`
> where `ExecResult = FilterOutputResult & { childExitCode: number
> | null; terminated?: "timeout" | "max_bytes" }`. **Note three
> binding facts (F1, critic-locked):** `command_denied` carries
> **`code`** (the `PolicyDenyCode`), NOT `detail`; the failure
> reason is **`command_failed`**, NOT `redaction_failed`
> (redaction is internal to `filterOutput` and is never a command
> outcome — AA1 §8d step 6); the `run-command` adapter `switch`
> below is exhaustive against this exact union.

- [ ] **Step 1: Write the failing read-file test**

Create `packages/mcp-bridge/test/tools/read-file.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleReadFile } from "../../src/tools/read-file.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

describe("handleReadFile", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-read-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-read-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("filters an in-sandbox file and returns a result with chunkSetId", async () => {
    const registry = seededRegistry(projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\nerror: boom\nline three\n");
    const result = await handleReadFile(
      { registry, storeRoot: store, now: () => TS, newId: () => "cs-fixed" },
      { path: logPath, intent: "find the error", sessionId: SESSION_ID },
    );
    expect(result.chunkSetId).toBe("cs-fixed");
    expect(result.rawBytes).toBeGreaterThan(0);
  });

  it("throws intent_required when intent is empty", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: join(projectRoot, "a.txt"), intent: "", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "intent_required" });
  });

  it("throws session_not_found for an unknown session", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        {
          path: join(projectRoot, "a.txt"),
          intent: "x",
          sessionId: "33333333-3333-4333-8333-333333333333",
        },
      ),
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("throws path_denied for a secret path", async () => {
    const registry = seededRegistry(projectRoot);
    const envPath = join(projectRoot, ".env");
    await writeFile(envPath, "SECRET=1\n");
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: envPath, intent: "peek", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "path_denied" });
  });

  it("throws max_bytes_exceeded above the 64000 ceiling", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: join(projectRoot, "a.txt"), intent: "x", sessionId: SESSION_ID, maxBytes: 70_000 },
      ),
    ).rejects.toMatchObject({ code: "max_bytes_exceeded" });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test read-file`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `read-file.ts`**

Create `packages/mcp-bridge/src/tools/read-file.ts`:

```ts
import {
  type CoreRegistry,
  type FilterOutputResult,
  runOutputPipeline,
} from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

const MAX_BYTES_CEILING = 64_000; // 2 * modeToBudget("safe"), AA1 §8a

export type ReadFileToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
};

const readFileInputSchema = z
  .object({
    path: z.string().min(1),
    intent: z.string(),
    sessionId: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export async function handleReadFile(
  env: ReadFileToolEnv,
  rawArgs: unknown,
): Promise<FilterOutputResult> {
  const parsed = readFileInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { path, intent, sessionId, maxBytes } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_read_file requires a non-empty intent");
  }
  if (maxBytes !== undefined && maxBytes > MAX_BYTES_CEILING) {
    throw new McpBridgeError(
      "max_bytes_exceeded",
      `maxBytes ${maxBytes} exceeds ceiling ${MAX_BYTES_CEILING}`,
    );
  }

  const outcome = await runOutputPipeline({
    registry: env.registry,
    storeRoot: env.storeRoot,
    sessionId: sessionId as Parameters<typeof runOutputPipeline>[0]["sessionId"],
    path,
    intent,
    now: env.now,
    newId: env.newId,
  });

  if (outcome.ok) return outcome.result;
  switch (outcome.reason) {
    case "session_not_found":
      throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
    case "path_denied":
      throw new McpBridgeError("path_denied", outcome.detail, {
        details: { reason: outcome.detail },
      });
    case "path_unsafe":
      throw new McpBridgeError("validation_failed", outcome.detail);
    case "file_read_failed":
      throw new McpBridgeError("tool_invocation_failed", outcome.detail, {
        cause: new Error(outcome.detail),
      });
  }
}
```

> `sessionId` is branded `SessionId` in core; the orchestrator
> validates ownership downstream and `runTwoGates` already
> guards the path, so the boundary parse is `z.string().min(1)`
> cast at the call. The `switch` is exhaustive over BB7a
> `RunOutputResult.reason` (verified against
> `packages/core/src/context-gate/run.ts`).

- [ ] **Step 4: Run read-file test — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test read-file`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing run-command test**

Create `packages/mcp-bridge/test/tools/run-command.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRunCommand } from "../../src/tools/run-command.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

describe("handleRunCommand", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-run-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-run-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  // originPid === String(process.pid) → root MegaSaver, no
  // re-entry (AA1 §9a). Use an allow-listed command (`ls`, AA1
  // §9b); `echo` is a shell builtin and NOT in ALLOWED_COMMANDS.
  it("returns a filtered command result for an allowed command", async () => {
    const registry = seededRegistry(projectRoot);
    const result = await handleRunCommand(
      {
        registry,
        storeRoot: store,
        now: () => TS,
        newId: () => "cs-run",
        originPid: String(process.pid),
      },
      { command: "ls", args: ["-a"], intent: "see output", sessionId: SESSION_ID },
    );
    expect(result.rawBytes).toBeGreaterThanOrEqual(0);
    expect(result.chunkSetId).toBeDefined();
  });

  it("throws command_denied carrying details.reason (the PolicyDenyCode) for a denied command", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleRunCommand(
        { registry, storeRoot: store, now: () => TS, newId: () => "x", originPid: String(process.pid) },
        { command: "rm", args: ["-rf", "/"], intent: "x", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({
      code: "command_denied",
      // F1: BB7b returns `code` (PolicyDenyCode); the adapter maps
      // it to `details.reason`. rm -rf / → dangerous_pattern (§9c).
      details: { reason: "dangerous_pattern" },
    });
  });

  it("throws intent_required when intent is empty", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleRunCommand(
        { registry, storeRoot: store, now: () => TS, newId: () => "x", originPid: String(process.pid) },
        { command: "ls", args: [], intent: "", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "intent_required" });
  });
});
```

- [ ] **Step 6: Run — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test run-command`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `run-command.ts`**

Create `packages/mcp-bridge/src/tools/run-command.ts`:

```ts
import {
  type CoreRegistry,
  type ExecResult,
  runOutputExecCommand,
} from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

const MAX_BYTES_CEILING = 64_000; // 2 * modeToBudget("safe"), AA1 §8a
const SPAWN_TIMEOUT_MS = 5 * 60 * 1000; // AA1 §8d step 5
const MAX_CAPTURE_FACTOR = 64; // raw capture cap = 64 * maxBytes (AA1 §8d step 5)

export type RunCommandToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
  // AA1 §8d step 3: the resolved MEGASAVER_ORIGIN_PID for this
  // bridge process (own pid if root; inherited if downstream).
  originPid: string;
};

const runCommandInputSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).readonly(),
    intent: z.string(),
    sessionId: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export async function handleRunCommand(
  env: RunCommandToolEnv,
  rawArgs: unknown,
): Promise<ExecResult> {
  const parsed = runCommandInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { command, args, intent, sessionId, maxBytes } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_run_command requires a non-empty intent");
  }
  if (maxBytes !== undefined && maxBytes > MAX_BYTES_CEILING) {
    throw new McpBridgeError(
      "max_bytes_exceeded",
      `maxBytes ${maxBytes} exceeds ceiling ${MAX_BYTES_CEILING}`,
    );
  }

  // BB7b orchestrator (authoritative: bb7b-output-exec-plan.md
  // Task 1). It owns spawn, env-marker check (AA1 §8d steps 3+5),
  // redact (step 6), filterOutput (step 7), saveChunkSet (step 8),
  // and stats (step 9). The bridge never spawns — single spawn site.
  const outcome = await runOutputExecCommand({
    registry: env.registry,
    storeRoot: env.storeRoot,
    sessionId: sessionId as Parameters<typeof runOutputExecCommand>[0]["sessionId"],
    command,
    args,
    intent,
    originPid: env.originPid,
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxCaptureBytes: (maxBytes ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
    now: env.now,
    newId: env.newId,
  });

  if (outcome.ok) return outcome.result;
  // Exhaustive over RunOutputExecCommandResult (F1; see IMPORT
  // BINDING NOTE). NOTE: command_denied carries `code`
  // (PolicyDenyCode), NOT `detail`; there is no `redaction_failed`
  // outcome — failures surface as `command_failed`.
  switch (outcome.reason) {
    case "session_not_found":
      throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
    case "command_denied":
      throw new McpBridgeError("command_denied", `command denied: ${outcome.code}`, {
        details: { reason: outcome.code },
      });
    case "command_failed":
      throw new McpBridgeError("tool_invocation_failed", outcome.detail, {
        cause: new Error(outcome.detail),
      });
    case "store_write_failed":
      throw new McpBridgeError("store_write_failed", outcome.detail);
  }
}
```

> The `switch` is exhaustive over BB7b's `RunOutputExecCommandResult`
> (the authoritative union — `bb7b-output-exec-plan.md` Task 1).
> `command_denied.code` is the `PolicyDenyCode` and becomes the
> wire `details.reason` (AA1 §8d step 4) — this is what carries
> `recursive_megasaver`. `command_failed` (spawn error / non-zero
> exit surfaced by the orchestrator) maps to `tool_invocation_failed`
> with `cause` set. `args` is passed straight through as the
> orchestrator's input type is `readonly string[]` (no spread
> needed). `ExecResult` extends `FilterOutputResult` with
> `childExitCode` + optional `terminated`, so the wire payload
> still carries `chunkSetId`/`savingRatio`/etc.

- [ ] **Step 8: Run run-command test — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test run-command`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/mcp-bridge/src/tools/read-file.ts packages/mcp-bridge/src/tools/run-command.ts packages/mcp-bridge/test/tools/read-file.test.ts packages/mcp-bridge/test/tools/run-command.test.ts
git commit -m "feat(mcp-bridge): add read-file + run-command tool handlers"
```

---

## Task 5: `mega_recall` handler

**Files:**
- Create: `packages/mcp-bridge/src/tools/recall.ts`
- Test: `packages/mcp-bridge/test/tools/recall.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-bridge/test/tools/recall.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRecall } from "../../src/tools/recall.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const MEM_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  registry.createMemoryEntry({
    id: MEM_ID,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    scope: "session",
    content: "use pnpm not npm",
    createdAt: TS,
  });
  return registry;
}

describe("handleRecall", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-recall-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("returns session memory and chunk-set summaries", async () => {
    const registry = seededRegistry();
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "cs-1.json"),
      JSON.stringify({
        chunkSetId: "cs-1",
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: TS,
        source: { kind: "file", path: "log.txt" },
        rawBytes: 5,
        redacted: true,
        chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
      }),
    );

    const result = await handleRecall(
      { registry, storeRoot: store },
      { sessionId: SESSION_ID, intent: "build tooling" },
    );
    expect(result.memory.map((m) => m.content)).toContain("use pnpm not npm");
    expect(result.chunkSets.map((c) => c.chunkSetId)).toContain("cs-1");
  });

  it("throws session_not_found for an unknown session", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecall(
        { registry, storeRoot: store },
        { sessionId: "33333333-3333-4333-8333-333333333333", intent: "x" },
      ),
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("throws intent_required when intent is empty", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecall({ registry, storeRoot: store }, { sessionId: SESSION_ID, intent: "" }),
    ).rejects.toMatchObject({ code: "intent_required" });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test recall`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `recall.ts`**

Create `packages/mcp-bridge/src/tools/recall.ts`:

```ts
import { type ChunkSetSummary, listChunkSets } from "@megasaver/content-store";
import type { CoreRegistry, MemoryEntry } from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RecallToolEnv = { registry: CoreRegistry; storeRoot: string };

const recallInputSchema = z
  .object({
    sessionId: z.string().min(1),
    intent: z.string(),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export type RecallToolResult = {
  memory: readonly MemoryEntry[];
  chunkSets: readonly ChunkSetSummary[];
};

export async function handleRecall(
  env: RecallToolEnv,
  rawArgs: unknown,
): Promise<RecallToolResult> {
  const parsed = recallInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { sessionId, intent } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_recall requires a non-empty intent");
  }

  const session = env.registry.getSession(sessionId as SessionId);
  if (session === null) {
    throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
  }

  const allMemory = env.registry.listMemoryEntries(session.projectId);
  const memory = allMemory.filter(
    (m) => m.sessionId === session.id || m.scope === "project",
  );
  const chunkSets = await listChunkSets({
    storeRoot: env.storeRoot,
    projectId: session.projectId,
    sessionId: session.id,
  });

  return { memory, chunkSets };
}
```

> AA1 §8a: `mega_recall` hits `registry.listMemoryEntries` +
> chunkSets via content-store. `listMemoryEntries(projectId)`
> returns project-scope entries; the filter keeps this session's
> session-scope entries plus project-scope entries (the recall
> context for the session). BM25 ranking by `intent` (AA1 §12) is
> a retrieval-package follow-up; BB8 returns the unranked set —
> the `intent` is validated (required) and threaded for the
> follow-up, not silently dropped.

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test recall`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/recall.ts packages/mcp-bridge/test/tools/recall.test.ts
git commit -m "feat(mcp-bridge): add mega_recall tool handler"
```

---

## Task 6: `server.ts` stdio wiring + dispatch + `createBridge`

**Files:**
- Create: `packages/mcp-bridge/src/server.ts`
- Modify (replace): `packages/mcp-bridge/src/bridge.ts`
- Modify (replace): `packages/mcp-bridge/test/bridge.test.ts`

- [ ] **Step 1: Write the failing bridge test (replace placeholder)**

Replace the entire contents of `packages/mcp-bridge/test/bridge.test.ts`:

```ts
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { createBridge } from "../src/bridge.js";

function bridgeConfig(transport: "stdio" | "sse") {
  return {
    transport,
    storeRoot: "/tmp/megasaver-bridge-test",
    registry: createInMemoryCoreRegistry(),
  };
}

describe("createBridge — real surface (BB8)", () => {
  it("exposes the parsed transport (API preserved, AA1 §2c)", () => {
    const bridge = createBridge(bridgeConfig("stdio"));
    expect(bridge.transport).toBe("stdio");
  });

  it("rejects an unknown transport at the boundary", () => {
    expect(() =>
      createBridge({
        transport: "websocket" as unknown as "stdio",
        storeRoot: "/tmp/x",
        registry: createInMemoryCoreRegistry(),
      }),
    ).toThrow();
  });

  it("start()/stop() are idempotent and resolve void for stdio", async () => {
    const bridge = createBridge(bridgeConfig("stdio"));
    await expect(bridge.start()).resolves.toBeUndefined();
    await expect(bridge.start()).resolves.toBeUndefined(); // idempotent (HH §6)
    await expect(bridge.stop()).resolves.toBeUndefined();
    await expect(bridge.stop()).resolves.toBeUndefined(); // idempotent
  });

  it("start() rejects transport_failed for sse (AA1 §8c)", async () => {
    const bridge = createBridge(bridgeConfig("sse"));
    await expect(bridge.start()).rejects.toMatchObject({
      name: "McpBridgeError",
      code: "transport_failed",
    });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test bridge`
Expected: FAIL — config schema rejects `storeRoot`/`registry`; `start()` still rejects `not_implemented`.

- [ ] **Step 3: Implement `server.ts`**

Create `packages/mcp-bridge/src/server.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CoreRegistry } from "@megasaver/core";
import { randomUUID } from "node:crypto";
import { McpBridgeError } from "./errors.js";
import { mcpToolNameSchema } from "./tool-name.js";
import { handleFetchChunk } from "./tools/fetch-chunk.js";
import { handleReadFile } from "./tools/read-file.js";
import { handleRecall } from "./tools/recall.js";
import { handleRunCommand } from "./tools/run-command.js";

export type ServerDeps = {
  registry: CoreRegistry;
  storeRoot: string;
  now?: () => string;
  newId?: () => string;
};

const TOOL_DEFS = [
  { name: "mega_fetch_chunk", description: "Fetch one stored chunk from a chunk set." },
  { name: "mega_read_file", description: "Read a file through the redact/filter pipeline." },
  { name: "mega_recall", description: "Recall session memory and stored chunk sets." },
  { name: "mega_run_command", description: "Run a policy-gated command and filter its output." },
] as const;

function resolveOriginPid(): string {
  // AA1 §8d step 3: inherit MEGASAVER_ORIGIN_PID if present (this
  // bridge is downstream of MegaSaver); otherwise this process is
  // the root and owns the marker.
  const inherited = process.env["MEGASAVER_ORIGIN_PID"];
  return inherited !== undefined && inherited !== "" ? inherited : String(process.pid);
}

export function buildServer(deps: ServerDeps): { server: Server; transport: StdioServerTransport } {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());
  const originPid = resolveOriginPid();
  const server = new Server(
    { name: "megasaver", version: "0.5.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object" } })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    const parsedName = mcpToolNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new McpBridgeError("tool_not_found", `unknown tool: ${name}`);
    }
    try {
      const payload = await dispatch(parsedName.data, args);
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    } catch (err) {
      if (err instanceof McpBridgeError) throw err;
      throw new McpBridgeError(
        "tool_invocation_failed",
        err instanceof Error ? err.message : "tool failed",
        { cause: err },
      );
    }
  });

  async function dispatch(toolName: ReturnType<typeof mcpToolNameSchema.parse>, args: unknown) {
    switch (toolName) {
      case "mega_fetch_chunk":
        return handleFetchChunk({ storeRoot: deps.storeRoot }, args);
      case "mega_read_file":
        return handleReadFile({ registry: deps.registry, storeRoot: deps.storeRoot, now, newId }, args);
      case "mega_recall":
        return handleRecall({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "mega_run_command":
        return handleRunCommand(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId, originPid },
          args,
        );
    }
  }

  return { server, transport: new StdioServerTransport() };
}
```

> The `dispatch` `switch` is exhaustive over `McpToolName`. An
> unknown name never reaches `dispatch` — it is rejected with
> `tool_not_found` at the parse (acceptance: AA1 §14 BB8).

- [ ] **Step 4: Implement `bridge.ts` (replace reject-stub)**

Replace the entire contents of `packages/mcp-bridge/src/bridge.ts`:

```ts
import type { CoreRegistry } from "@megasaver/core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { McpBridgeError } from "./errors.js";
import { buildServer } from "./server.js";
import { type McpTransport, mcpTransportSchema } from "./transport.js";

const mcpBridgeConfigSchema = z.object({
  transport: mcpTransportSchema,
  storeRoot: z.string().min(1),
});

export type McpBridgeConfig = z.infer<typeof mcpBridgeConfigSchema> & {
  // DI slots (AA1 §2c). Not part of the Zod-validated shape — the
  // registry is an object instance, validated by construction.
  registry: CoreRegistry;
  now?: () => string;
  newId?: () => string;
};

export type McpBridge = {
  readonly transport: McpTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createBridge(config: McpBridgeConfig): McpBridge {
  const parsed = mcpBridgeConfigSchema.parse({
    transport: config.transport,
    storeRoot: config.storeRoot,
  });

  let server: Server | undefined;
  let transport: StdioServerTransport | undefined;
  let running = false;

  return {
    transport: parsed.transport,
    async start() {
      if (parsed.transport === "sse") {
        throw new McpBridgeError(
          "transport_failed",
          "sse transport is reserved for v0.6+; only stdio is implemented (AA1 §8c)",
        );
      }
      if (running) return; // idempotent (HH §6)
      const built = buildServer({
        registry: config.registry,
        storeRoot: config.storeRoot,
        ...(config.now !== undefined ? { now: config.now } : {}),
        ...(config.newId !== undefined ? { newId: config.newId } : {}),
      });
      server = built.server;
      transport = built.transport;
      await server.connect(transport);
      running = true;
    },
    async stop() {
      if (!running) return; // idempotent
      await server?.close();
      server = undefined;
      transport = undefined;
      running = false;
    },
  };
}
```

- [ ] **Step 5: Run — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test bridge`
Expected: PASS (4 tests). Note: the idempotent `start()` test connects a real `StdioServerTransport` to stdin/stdout; under Vitest this attaches a `readline` to `process.stdin`. The test calls `stop()` to detach. If stdin attachment hangs Vitest, gate `start()` behind an injected transport (add an optional `transportFactory` to `ServerDeps` defaulting to `new StdioServerTransport()` and pass a no-op in the unit test). Prefer the no-op factory for the unit test; the real stdio round-trip is exercised in Task 8.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-bridge/src/server.ts packages/mcp-bridge/src/bridge.ts packages/mcp-bridge/test/bridge.test.ts
git commit -m "feat(mcp-bridge): real createBridge over stdio + tool dispatch"
```

---

## Task 7: setup — `detect-agent`, `install`, `repair`

**Files:**
- Create: `packages/mcp-bridge/src/setup/detect-agent.ts`
- Create: `packages/mcp-bridge/src/setup/install.ts`
- Create: `packages/mcp-bridge/src/setup/repair.ts`
- Test: `packages/mcp-bridge/test/setup/install.test.ts`

- [ ] **Step 1: Write the failing install test**

Create `packages/mcp-bridge/test/setup/install.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAgent } from "../../src/setup/detect-agent.js";
import { installMcp, uninstallMcp } from "../../src/setup/install.js";

describe("installMcp / uninstallMcp — idempotent (AA1 §5c)", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mcp-setup-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("detectAgent resolves the claude-code config path", () => {
    const d = detectAgent({ agentId: "claude-code", home });
    expect(d.configPath).toContain("claude");
    expect(d.serverKey).toBe("megasaver");
  });

  it("install writes the server entry then is a no-op on re-run", async () => {
    const first = await installMcp({ agentId: "claude-code", home, command: "mega-mcp" });
    expect(first.changed).toBe(true);
    const raw1 = JSON.parse(await readFile(first.configPath, "utf8")) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(raw1.mcpServers.megasaver.command).toBe("mega-mcp");

    const second = await installMcp({ agentId: "claude-code", home, command: "mega-mcp" });
    expect(second.changed).toBe(false);
    const raw2 = await readFile(second.configPath, "utf8");
    expect(JSON.parse(raw2)).toEqual(raw1);
  });

  it("uninstall removes the server entry and is a no-op when absent", async () => {
    await installMcp({ agentId: "claude-code", home, command: "mega-mcp" });
    const removed = await uninstallMcp({ agentId: "claude-code", home });
    expect(removed.changed).toBe(true);
    const raw = JSON.parse(await readFile(removed.configPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(raw.mcpServers.megasaver).toBeUndefined();

    const again = await uninstallMcp({ agentId: "claude-code", home });
    expect(again.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test install`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `detect-agent.ts`**

Create `packages/mcp-bridge/src/setup/detect-agent.ts`:

```ts
import { join } from "node:path";
import type { KnownAgentId } from "./agent-ids.js";

export type DetectedAgent = {
  agentId: KnownAgentId;
  configPath: string;
  serverKey: "megasaver";
};

// Per-agent MCP config location under the user's home. stdio
// servers register a launch command (AA1 §20d: each agent spawns
// its own bridge). Paths follow each agent's documented config.
export function detectAgent(input: { agentId: KnownAgentId; home: string }): DetectedAgent {
  const { agentId, home } = input;
  const configPath = ((): string => {
    switch (agentId) {
      case "claude-code":
        return join(home, ".config", "claude", "mcp.json");
      case "cursor":
        return join(home, ".cursor", "mcp.json");
      case "codex":
        return join(home, ".codex", "mcp.json");
      case "aider":
        return join(home, ".aider", "mcp.json");
    }
  })();
  return { agentId, configPath, serverKey: "megasaver" };
}
```

Create `packages/mcp-bridge/src/setup/agent-ids.ts`:

```ts
import { z } from "zod";

// Mirrors apps/cli/src/known-targets.ts KnownTargetId. Declared
// here so mcp-bridge does not import the CLI (dependency arrow,
// CLAUDE.md §8). The CLI validates against KNOWN_TARGET_IDS and
// passes a validated id in.
export const knownAgentIdSchema = z.enum(["claude-code", "codex", "cursor", "aider"]);
export type KnownAgentId = z.infer<typeof knownAgentIdSchema>;
```

- [ ] **Step 4: Implement `install.ts`**

Create `packages/mcp-bridge/src/setup/install.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectAgent } from "./detect-agent.js";
import type { KnownAgentId } from "./agent-ids.js";

export type InstallResult = { configPath: string; changed: boolean };

type McpConfig = { mcpServers: Record<string, { command: string; args?: string[] }> };

async function readConfig(configPath: string): Promise<McpConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<McpConfig>;
    return { mcpServers: parsed.mcpServers ?? {} };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw err;
  }
}

async function writeAtomic(configPath: string, config: McpConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const tmp = join(dirname(configPath), `.${randomUUID()}.tmp`);
  const body = `${JSON.stringify(config, null, 2)}\n`;
  try {
    await writeFile(tmp, body, "utf8");
    await rename(tmp, configPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function installMcp(input: {
  agentId: KnownAgentId;
  home: string;
  command: string;
}): Promise<InstallResult> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  const config = await readConfig(detected.configPath);
  const existing = config.mcpServers[detected.serverKey];
  if (existing !== undefined && existing.command === input.command) {
    return { configPath: detected.configPath, changed: false };
  }
  config.mcpServers[detected.serverKey] = { command: input.command };
  await writeAtomic(detected.configPath, config);
  return { configPath: detected.configPath, changed: true };
}

export async function uninstallMcp(input: {
  agentId: KnownAgentId;
  home: string;
}): Promise<InstallResult> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  const config = await readConfig(detected.configPath);
  if (config.mcpServers[detected.serverKey] === undefined) {
    return { configPath: detected.configPath, changed: false };
  }
  delete config.mcpServers[detected.serverKey];
  await writeAtomic(detected.configPath, config);
  return { configPath: detected.configPath, changed: true };
}

export function isMcpInstalled(input: { agentId: KnownAgentId; home: string }): Promise<boolean> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  return readConfig(detected.configPath).then(
    (c) => c.mcpServers[detected.serverKey] !== undefined,
  );
}
```

- [ ] **Step 5: Implement `repair.ts`**

Create `packages/mcp-bridge/src/setup/repair.ts`:

```ts
import type { KnownAgentId } from "./agent-ids.js";
import { type InstallResult, installMcp } from "./install.js";

export type RepairResult = {
  install: InstallResult;
  // connector sync is performed by the CLI (which owns
  // KNOWN_TARGETS + the registry); repair signals the caller to
  // run it. AA1 §5c: "install + connector sync, one call".
  connectorSyncRequested: true;
};

export async function repairMcp(input: {
  agentId: KnownAgentId;
  home: string;
  command: string;
}): Promise<RepairResult> {
  const install = await installMcp(input);
  return { install, connectorSyncRequested: true };
}
```

> AA1 §5c locks `repair` = install + `connector sync --target
> <id>`. The connector sync needs `KNOWN_TARGETS` + the registry,
> which live in the CLI, and `connectors/shared` must not be
> imported by mcp-bridge in the reverse direction. So `repairMcp`
> performs the install and the CLI `mega mcp repair` invokes
> `runConnectorSync` after it (Task 8). This keeps the dependency
> arrow clean (`CLAUDE.md` §8).

- [ ] **Step 6: Run — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test install`
Expected: PASS (3 tests).

- [ ] **Step 7: Add setup exports + commit**

Append to `packages/mcp-bridge/src/index.ts` (after the existing four lines). `status`, `restart-hint`, and `setup-ops` are added in Task 7b — append their exports here in that task to keep one barrel edit per concept; for now add the four primitive modules:

```ts
export * from "./setup/agent-ids.js";
export * from "./setup/detect-agent.js";
export * from "./setup/install.js";
export * from "./setup/repair.js";
```

```bash
git add packages/mcp-bridge/src/setup packages/mcp-bridge/src/index.ts packages/mcp-bridge/test/setup/install.test.ts
git commit -m "feat(mcp-bridge): idempotent agent MCP install/repair/detect"
```

---

## Task 7b: `McpSetupOps` facade + shared `aggregateMcpStatus` (F2/F4/F6 — BB8-owned)

> **Critic-locked (F2/F4/F6).** BB11 (`bb11-gui-doctor-design.md`
> §3) consumes a high-level facade + a per-agent status snapshot
> carrying `mcpInstalled`, **`connectorSynced` (F4)**, `restartRequired`,
> and **`restartHint` (F6)**. BB8 OWNS this facade and the status
> shape. The `mega mcp status` CLI (Task 8) and the GUI bridge
> (Task 8b) both route through ONE shared `aggregateMcpStatus` so
> CLI and GUI never diverge. The facade is built ON TOP of the
> Task-7 primitives (`installMcp`/`uninstallMcp`/`isMcpInstalled`/
> `detectAgent`); it adds no new spawn/IO beyond config reads + an
> injected connector-block presence check.

**Files:**
- Create: `packages/mcp-bridge/src/setup/restart-hint.ts`
- Create: `packages/mcp-bridge/src/setup/status.ts`
- Create: `packages/mcp-bridge/src/setup/setup-ops.ts`
- Modify: `packages/mcp-bridge/src/index.ts`
- Test: `packages/mcp-bridge/test/setup/setup-ops.test.ts`

- [ ] **Step 1: Write the failing facade test**

Create `packages/mcp-bridge/test/setup/setup-ops.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMcpSetupOps } from "../../src/setup/setup-ops.js";

describe("buildMcpSetupOps — facade (F2/F4/F6)", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mcp-ops-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // The connectorSynced resolver is injected (the CLI/GUI supply a
  // real one over parseBlock); the test fakes it deterministically.
  function ops(connectorSynced: (agentId: string) => Promise<boolean>) {
    return buildMcpSetupOps({
      home,
      command: "mega-mcp",
      connectorSyncedResolver: connectorSynced,
      // repair's connector-sync side effect is also injected so the
      // facade stays free of CLI/registry coupling (AA1 §2c DI).
      connectorSync: async () => undefined,
    });
  }

  it("status() returns one row per known agent with all five fields", async () => {
    const result = await ops(async () => false).status();
    expect(result.agents).toHaveLength(4);
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude).toMatchObject({
      target: "claude-code",
      agentId: "claude-code",
      mcpInstalled: false,
      connectorSynced: false,
      restartRequired: false,
      restartHint: expect.stringContaining("Claude Code"),
    });
  });

  it("install() flips mcpInstalled + restartRequired true in the returned snapshot", async () => {
    const result = await ops(async () => false).install("claude-code", "demo");
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude).toMatchObject({ mcpInstalled: true, restartRequired: true });
    // the config file was actually written by the underlying primitive
    const raw = JSON.parse(
      await readFile(join(home, ".config", "claude", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, unknown> };
    expect(raw.mcpServers.megasaver).toBeDefined();
  });

  it("repair() runs the injected connectorSync and reports connectorSynced true after", async () => {
    let synced = false;
    const o = buildMcpSetupOps({
      home,
      command: "mega-mcp",
      connectorSyncedResolver: async () => synced,
      connectorSync: async () => {
        synced = true; // simulate the connector block landing
      },
    });
    const result = await o.repair("claude-code", "demo");
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude).toMatchObject({ mcpInstalled: true, connectorSynced: true });
  });

  it("uninstall() flips mcpInstalled back to false", async () => {
    const o = ops(async () => true);
    await o.install("claude-code", "demo");
    const result = await o.uninstall("claude-code");
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude?.mcpInstalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test setup-ops`
Expected: FAIL — `../../src/setup/setup-ops.js` not found.

- [ ] **Step 3: Implement `restart-hint.ts`**

Create `packages/mcp-bridge/src/setup/restart-hint.ts`:

```ts
import type { KnownAgentId } from "./agent-ids.js";

// F6 (critic-locked): BB8 OWNS the per-agent restartHint; BB11
// surfaces it, never hard-codes it. claude-code + cursor strings
// are confident; codex + aider mechanics are unverified against
// current agent docs — see NOTE below; confirm at execution.
export function restartHint(agentId: KnownAgentId): string {
  switch (agentId) {
    case "claude-code":
      return "Restart Claude Code (quit and reopen) to load the Mega Saver MCP server.";
    case "cursor":
      return "Reload the Cursor window (Cmd/Ctrl+Shift+P → Reload Window) to pick up the MCP server.";
    case "codex":
      return "Restart Codex to load the Mega Saver MCP server.";
    case "aider":
      return "Restart Aider to load the Mega Saver MCP server.";
  }
}
```

> **NOTE (execution-time confirmation, F6).** The `claude-code`
> and `cursor` strings match `bb11-gui-doctor-design.md` §3a
> verbatim. The `codex` and `aider` MCP-registration restart
> mechanics are unverified (no in-repo MCP registration exists
> until BB8 merges; AA1 §8c only asserts all four accept a launch
> command). These two use the generic `"Restart <agent> to load
> the Mega Saver MCP server."` form per the parent F6 resolution.
> Confirm the exact codex/aider wording during BB8 execution and
> update both this function and `bb11-gui-doctor-design.md` §3a
> together. BB11 consumes whatever this returns — it never
> hard-codes, so BB11 is unblocked regardless.

- [ ] **Step 4: Implement `status.ts` (the ONE shared aggregation)**

Create `packages/mcp-bridge/src/setup/status.ts`:

```ts
import type { AgentId } from "@megasaver/shared";
import { knownAgentIdSchema, type KnownAgentId } from "./agent-ids.js";
import { isMcpInstalled } from "./install.js";
import { restartHint } from "./restart-hint.js";

// F4: per-agent snapshot. `target` and `agentId` are the same four
// strings in this codebase (apps/cli/src/known-targets.ts: every
// KnownTarget has id === agentId), but both are surfaced so BB11's
// McpAgentStatus serialises directly without a second lookup.
export type McpAgentStatus = {
  target: KnownAgentId;
  agentId: AgentId;
  mcpInstalled: boolean;
  connectorSynced: boolean;
  restartRequired: boolean;
  restartHint: string;
};

export type McpStatusResult = { agents: readonly McpAgentStatus[] };

// Injected so mcp-bridge does not import the CLI or connectors-shared
// (AA1 §3 dependency arrow; §2c DI). The CLI/GUI pass a resolver
// that reads the connector file and runs parseBlock.
export type ConnectorSyncedResolver = (agentId: KnownAgentId) => Promise<boolean>;

const ALL_AGENTS = knownAgentIdSchema.options;

export async function aggregateMcpStatus(input: {
  home: string;
  connectorSyncedResolver: ConnectorSyncedResolver;
}): Promise<McpStatusResult> {
  const agents: McpAgentStatus[] = [];
  for (const agentId of ALL_AGENTS) {
    const mcpInstalled = await isMcpInstalled({ agentId, home: input.home });
    const connectorSynced = await input.connectorSyncedResolver(agentId);
    agents.push({
      target: agentId,
      agentId,
      mcpInstalled,
      connectorSynced,
      // restartRequired mirrors mcpInstalled in v0.5: a present
      // config requires the agent to restart to pick it up
      // (AA1 §5c, §20c). BB11 derives row state from this.
      restartRequired: mcpInstalled,
      restartHint: restartHint(agentId),
    });
  }
  return { agents };
}
```

- [ ] **Step 5: Implement `setup-ops.ts` (the facade)**

Create `packages/mcp-bridge/src/setup/setup-ops.ts`:

```ts
import type { KnownAgentId } from "./agent-ids.js";
import { installMcp, uninstallMcp } from "./install.js";
import { aggregateMcpStatus, type ConnectorSyncedResolver, type McpStatusResult } from "./status.js";

// F2 (critic-locked): the high-level facade BB11 consumes. Every
// op returns a fresh post-op McpStatusResult snapshot (LL
// re-fetch-on-mutation; AA1 §1 non-goal "real-time push").
export interface McpSetupOps {
  status(): Promise<McpStatusResult>;
  install(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  repair(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  uninstall(target: KnownAgentId): Promise<McpStatusResult>;
}

export type BuildMcpSetupOpsDeps = {
  home: string;
  command: string;
  connectorSyncedResolver: ConnectorSyncedResolver;
  // AA1 §5c: repair = install + connector sync for that agent. The
  // sync needs KNOWN_TARGETS + the registry (CLI/GUI), so it is
  // injected — keeps the facade free of CLI coupling (§2c DI).
  connectorSync: (target: KnownAgentId, project: string) => Promise<void>;
};

export function buildMcpSetupOps(deps: BuildMcpSetupOpsDeps): McpSetupOps {
  const snapshot = (): Promise<McpStatusResult> =>
    aggregateMcpStatus({ home: deps.home, connectorSyncedResolver: deps.connectorSyncedResolver });

  return {
    status() {
      return snapshot();
    },
    async install(target, _project) {
      await installMcp({ agentId: target, home: deps.home, command: deps.command });
      return snapshot();
    },
    async repair(target, project) {
      await installMcp({ agentId: target, home: deps.home, command: deps.command });
      await deps.connectorSync(target, project); // AA1 §5c second effect
      return snapshot();
    },
    async uninstall(target) {
      await uninstallMcp({ agentId: target, home: deps.home });
      return snapshot();
    },
  };
}
```

> The facade does NOT validate `target` — callers pass a
> `KnownAgentId` already narrowed (CLI via `isKnownTargetId`, GUI
> via the route's `MEGA_MCP_TARGET_BODY` Zod enum). `install`'s
> `project` is unused (install needs no project) but kept in the
> interface so `install`/`repair` share one call shape for BB11's
> route handlers; `repair` uses it for the connector sync.

- [ ] **Step 6: Add barrel exports**

Append to `packages/mcp-bridge/src/index.ts`:

```ts
export * from "./setup/restart-hint.js";
export * from "./setup/status.js";
export * from "./setup/setup-ops.js";
```

- [ ] **Step 7: Run — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test setup-ops`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-bridge/src/setup/restart-hint.ts packages/mcp-bridge/src/setup/status.ts packages/mcp-bridge/src/setup/setup-ops.ts packages/mcp-bridge/src/index.ts packages/mcp-bridge/test/setup/setup-ops.test.ts
git commit -m "feat(mcp-bridge): McpSetupOps facade + shared status aggregation"
```

---

## Task 8: `mega mcp` CLI (4 subcommands + `--json`) + acceptance e2e

**Files:**
- Create: `apps/cli/src/commands/mcp/{install,repair,status,uninstall,index}.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/errors.ts`
- Test: `apps/cli/test/mcp/install.test.ts`, `apps/cli/test/mcp/status.test.ts`
- Test: `packages/mcp-bridge/test/server.e2e.test.ts`
- Modify: `apps/cli/test/json-failure-paths.test.ts`

- [ ] **Step 1: Add `unknownTargetMessage` to CLI errors**

Add to `apps/cli/src/errors.ts` (after `invalidTargetMessage`):

```ts
export function unknownTargetMessage(value: string): CliMessage {
  return {
    message: `error: unknown_target "${value}", expected: ${KNOWN_TARGET_IDS.join(" | ")}`,
    exitCode: 1,
  };
}
```

- [ ] **Step 2: Write the failing CLI install test**

Create `apps/cli/test/mcp/install.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpInstall } from "../../src/commands/mcp/install.js";

describe("runMcpInstall", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cli-mcp-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("installs idempotently and prints text", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("claude-code");
    const code2 = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
    });
    expect(code2).toBe(0);
    expect(out.join("\n")).toMatch(/already|no-op|unchanged/i);
  });

  it("emits JSON with changed flag", async () => {
    const out: string[] = [];
    const code = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: (l) => out.push(l),
      stderr: () => undefined,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out[0] ?? "") as { target: string; changed: boolean };
    expect(parsed).toMatchObject({ target: "claude-code", changed: true });
  });

  it("rejects an unknown target with exit 1", async () => {
    const err: string[] = [];
    const code = await runMcpInstall({
      targetFlag: "notanagent",
      home,
      stdout: () => undefined,
      stderr: (l) => err.push(l),
      json: false,
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("unknown_target");
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `pnpm --filter @megasaver/cli test mcp/install`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `install.ts`**

Create `apps/cli/src/commands/mcp/install.ts`:

```ts
import { installMcp } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";

export type RunMcpInstallInput = {
  targetFlag: string;
  home: string;
  command?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpInstall(input: RunMcpInstallInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.targetFlag)) {
    const cli = unknownTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const command = input.command ?? "mega-mcp";
  const result = await installMcp({ agentId: input.targetFlag, home: input.home, command });
  if (input.json) {
    input.stdout(
      JSON.stringify({ target: input.targetFlag, changed: result.changed, configPath: result.configPath }),
    );
  } else {
    input.stdout(
      result.changed
        ? `Installed Mega Saver MCP for ${input.targetFlag} at ${result.configPath}`
        : `Mega Saver MCP already installed for ${input.targetFlag} (no-op)`,
    );
  }
  return 0;
}

export const mcpInstallCommand = defineCommand({
  meta: { name: "install", description: "Install the Mega Saver MCP server into an agent config." },
  args: {
    target: { type: "string", required: true, description: "Agent id." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpInstall({
      targetFlag: typeof args.target === "string" ? args.target : "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 5: Implement `uninstall.ts`**

Create `apps/cli/src/commands/mcp/uninstall.ts`:

```ts
import { uninstallMcp } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";

export type RunMcpUninstallInput = {
  targetFlag: string;
  home: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpUninstall(input: RunMcpUninstallInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.targetFlag)) {
    const cli = unknownTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const result = await uninstallMcp({ agentId: input.targetFlag, home: input.home });
  if (input.json) {
    input.stdout(JSON.stringify({ target: input.targetFlag, changed: result.changed }));
  } else {
    input.stdout(
      result.changed
        ? `Removed Mega Saver MCP for ${input.targetFlag}`
        : `Mega Saver MCP not installed for ${input.targetFlag} (no-op)`,
    );
  }
  return 0;
}

export const mcpUninstallCommand = defineCommand({
  meta: { name: "uninstall", description: "Remove the Mega Saver MCP server from an agent config." },
  args: {
    target: { type: "string", required: true, description: "Agent id." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpUninstall({
      targetFlag: typeof args.target === "string" ? args.target : "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 5b: Implement the CLI-side `connectorSynced` resolver (F4)**

Create `apps/cli/src/commands/mcp/connector-synced.ts`. This reads
the agent's connector file and uses `parseBlock` to detect whether
the Mega Saver block is present (the `connector sync` artifact).
It is the resolver the CLI injects into `aggregateMcpStatus` so
the `connectorSynced` field is real, not a guess. AA1 §5c.

```ts
import { join } from "node:path";
import { parseBlock, readTargetFile } from "@megasaver/connectors-shared";
import type { KnownAgentId } from "@megasaver/mcp-bridge";
import { KNOWN_TARGETS } from "../../known-targets.js";

// Returns a resolver bound to a resolved project root. A block is
// "synced" when the connector file exists AND parseBlock finds the
// Mega Saver sentinel pair (block !== null).
export function makeConnectorSyncedResolver(projectRoot: string) {
  return async (agentId: KnownAgentId): Promise<boolean> => {
    const target = KNOWN_TARGETS.find((t) => t.id === agentId);
    if (target === undefined) return false;
    const existing = await readTargetFile(join(projectRoot, target.relativePath));
    if (existing === null) return false;
    return parseBlock(existing).block !== null;
  };
}
```

- [ ] **Step 6: Implement `status.ts` (routes through the shared `aggregateMcpStatus` — F4)**

Create `apps/cli/src/commands/mcp/status.ts`. The CLI and the GUI
bridge both call `aggregateMcpStatus`; there is ONE status shape
(F4). When no project root is resolvable (status is project-
agnostic for the install bit), `connectorSynced` defaults to
`false` via a resolver that always returns false unless a
`--project`/`--store` pair resolves a root.

```ts
import { aggregateMcpStatus } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { makeConnectorSyncedResolver } from "./connector-synced.js";

export type RunMcpStatusInput = {
  home: string;
  projectRoot: string | undefined; // when known, enables connectorSynced
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpStatus(input: RunMcpStatusInput): Promise<0 | 1> {
  const connectorSyncedResolver =
    input.projectRoot === undefined
      ? async () => false
      : makeConnectorSyncedResolver(input.projectRoot);

  const result = await aggregateMcpStatus({
    home: input.home,
    connectorSyncedResolver,
  });

  if (input.json) {
    input.stdout(JSON.stringify(result.agents));
  } else {
    for (const a of result.agents) {
      input.stdout(
        `${a.agentId}: mcp=${a.mcpInstalled ? "installed" : "missing"} connectorSynced=${a.connectorSynced} restartRequired=${a.restartRequired}`,
      );
    }
  }
  return 0;
}

export const mcpStatusCommand = defineCommand({
  meta: { name: "status", description: "Report per-agent Mega Saver MCP install state." },
  args: {
    project: { type: "string", description: "Project name; enables the connectorSynced check." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    // projectRoot is left undefined here: `mega mcp status`
    // reports the install bit (which is project-agnostic). The GUI
    // route (Task 8b) supplies a resolved root so the doctor's
    // connectorSynced reflects the real block. `--project`/`--store`
    // are accepted for forward use by the resolver.
    const code = await runMcpStatus({
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      projectRoot: undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> **F4.** `connectorSynced` is now a real field on every row,
> produced by the SAME `aggregateMcpStatus` the GUI uses (Task 8b)
> — CLI and GUI cannot drift. `restartRequired` mirrors
> `mcpInstalled` (AA1 §5c, §20c). The CLI `status` command leaves
> `projectRoot` undefined for simplicity (its primary job is the
> install bit); the GUI route (Task 8b) supplies the resolved root
> so the doctor's `connectorSynced` reflects the real block. If
> the CLI later needs project-scoped `connectorSynced`, resolve
> the root from `--project`/`--store` and pass it — the resolver
> already supports it.

- [ ] **Step 7: Implement `repair.ts`**

Create `apps/cli/src/commands/mcp/repair.ts`:

```ts
import { repairMcp } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";
import { runConnectorSync } from "../connector/sync.js";

export type RunMcpRepairInput = {
  targetFlag: string;
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  command?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpRepair(input: RunMcpRepairInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.targetFlag)) {
    const cli = unknownTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const command = input.command ?? "mega-mcp";
  const repaired = await repairMcp({ agentId: input.targetFlag, home: input.home, command });

  // AA1 §5c: repair = install + connector sync for the same agent.
  const syncCode = await runConnectorSync({
    projectName: input.projectName,
    targetFlag: input.targetFlag,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    stdout: input.stdout,
    stderr: input.stderr,
    json: input.json,
  });

  if (input.json) {
    input.stdout(
      JSON.stringify({ target: input.targetFlag, changed: repaired.install.changed, connectorSync: syncCode === 0 }),
    );
  } else {
    input.stdout(`Repaired Mega Saver MCP for ${input.targetFlag} (connector sync exit ${syncCode})`);
  }
  return syncCode === 0 ? 0 : 1;
}

export const mcpRepairCommand = defineCommand({
  meta: { name: "repair", description: "Install MCP config and re-sync the connector block." },
  args: {
    target: { type: "string", required: true, description: "Agent id." },
    project: { type: "string", required: true, description: "Project name (for connector sync)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpRepair({
      targetFlag: typeof args.target === "string" ? args.target : "",
      projectName: typeof args.project === "string" ? args.project : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> `repair` needs `--project` because `connector sync` is project-
> scoped (`runConnectorSync` takes `projectName`). AA1 §5c says
> "install + connector sync --target <id>"; the project is the
> sync's required positional in this codebase, so it is a required
> flag on repair. This is a surface detail AA1 left to the child
> spec; flagged for reviewer.

- [ ] **Step 8: Implement `index.ts` + register in `main.ts`**

Create `apps/cli/src/commands/mcp/index.ts`:

```ts
import { defineCommand } from "citty";
import { mcpInstallCommand } from "./install.js";
import { mcpRepairCommand } from "./repair.js";
import { mcpStatusCommand } from "./status.js";
import { mcpUninstallCommand } from "./uninstall.js";

export {
  type RunMcpInstallInput,
  runMcpInstall,
  mcpInstallCommand,
} from "./install.js";
export {
  type RunMcpRepairInput,
  runMcpRepair,
  mcpRepairCommand,
} from "./repair.js";
export {
  type RunMcpStatusInput,
  runMcpStatus,
  mcpStatusCommand,
} from "./status.js";
export {
  type RunMcpUninstallInput,
  runMcpUninstall,
  mcpUninstallCommand,
} from "./uninstall.js";

export const mcpCommand = defineCommand({
  meta: { name: "mcp", description: "Manage the Mega Saver MCP server installation." },
  subCommands: {
    install: mcpInstallCommand,
    repair: mcpRepairCommand,
    status: mcpStatusCommand,
    uninstall: mcpUninstallCommand,
  },
});
```

Edit `apps/cli/src/main.ts` — add the import and register the command:

```ts
import { mcpCommand } from "./commands/mcp/index.js";
```

and add `mcp: mcpCommand,` to the `subCommands` object (after `output: outputCommand,`).

- [ ] **Step 9: Run CLI install test — verify it passes**

Run: `pnpm --filter @megasaver/cli test mcp/install`
Expected: PASS (3 tests).

- [ ] **Step 9b: Write + run the CLI status test (asserts `connectorSynced` field — F4)**

Create `apps/cli/test/mcp/status.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpInstall } from "../../src/commands/mcp/install.js";
import { runMcpStatus } from "../../src/commands/mcp/status.js";

describe("runMcpStatus", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cli-mcp-status-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("emits one JSON row per agent carrying connectorSynced + restartRequired (F4)", async () => {
    await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: () => undefined,
      stderr: () => undefined,
      json: true,
    });
    const out: string[] = [];
    const code = await runMcpStatus({
      home,
      projectRoot: undefined,
      stdout: (l) => out.push(l),
      stderr: () => undefined,
      json: true,
    });
    expect(code).toBe(0);
    const rows = JSON.parse(out[0] ?? "[]") as Array<{
      agentId: string;
      mcpInstalled: boolean;
      connectorSynced: boolean;
      restartRequired: boolean;
    }>;
    expect(rows).toHaveLength(4);
    const claude = rows.find((r) => r.agentId === "claude-code");
    expect(claude).toMatchObject({
      mcpInstalled: true,
      connectorSynced: false, // no connector file in a bare temp home
      restartRequired: true,
    });
  });
});
```

Run: `pnpm --filter @megasaver/cli test mcp/status`
Expected: PASS (1 test).

- [ ] **Step 10: Write the acceptance e2e (stdio round-trip)**

Create `packages/mcp-bridge/test/server.e2e.test.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

async function connect(projectRoot: string, store: string) {
  const { server } = buildServer({
    registry: seededRegistry(projectRoot),
    storeRoot: store,
    now: () => TS,
    newId: () => "cs-e2e",
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

describe("bridge stdio round-trip (AA1 §14 BB8 acceptance)", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("mega_run_command (allowed) returns a filtered response", async () => {
    const { client, server } = await connect(projectRoot, store);
    const res = (await client.callTool({
      name: "mega_run_command",
      arguments: { command: "ls", args: ["-a"], intent: "list files", sessionId: SESSION_ID },
    })) as { content: { type: string; text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { chunkSetId?: string };
    expect(payload.chunkSetId).toBeDefined();
    await server.close();
  });

  it("policy-denied command surfaces command_denied", async () => {
    const { client, server } = await connect(projectRoot, store);
    await expect(
      client.callTool({
        name: "mega_run_command",
        arguments: { command: "rm", args: ["-rf", "/"], intent: "x", sessionId: SESSION_ID },
      }),
    ).rejects.toThrow(/command_denied/);
    await server.close();
  });

  it("unknown tool returns tool_not_found", async () => {
    const { client, server } = await connect(projectRoot, store);
    await expect(
      client.callTool({ name: "mega_delete_everything", arguments: {} }),
    ).rejects.toThrow(/tool_not_found/);
    await server.close();
  });
});
```

> The e2e uses the SDK's `InMemoryTransport.createLinkedPair()` —
> the same JSON-RPC envelope as stdio without spawning a process
> (deterministic in CI). It satisfies the AA1 §14 BB8 acceptance
> trio. The literal stdio-over-a-spawned-child path (claude-code
> launching `mega-mcp`) is exercised once by hand during the
> manual confirmation step and recorded in the verifier bundle
> (the child-process whitelist verification, AA1 §16).

- [ ] **Step 11: Run the e2e — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: PASS (3 tests). If the SDK error surfaces as a wrapped JSON-RPC error whose message embeds the code differently, assert on `err.message` containing the code string or `(err as { code?: number }).code`; adjust the `toThrow` regex to match the SDK's error text (the code string `command_denied` / `tool_not_found` is carried in the `McpBridgeError.message`).

- [ ] **Step 12: Extend JSON failure-path drift test**

Add to `apps/cli/test/json-failure-paths.test.ts` (follow the file's existing row shape) cases for:
- `mcp install --target notanagent --json` → exit 1, stderr contains `unknown_target`.
- `mcp uninstall --target notanagent --json` → exit 1, stderr contains `unknown_target`.

Use the exact structure already in that file (read it first; it enumerates `{ argv, expectExit, expectStderrIncludes }` rows or equivalent). Mirror an existing connector/saver invalid-target row.

- [ ] **Step 13: Commit**

```bash
git add apps/cli/src/commands/mcp apps/cli/src/main.ts apps/cli/src/errors.ts apps/cli/test/mcp packages/mcp-bridge/test/server.e2e.test.ts apps/cli/test/json-failure-paths.test.ts
git commit -m "feat(cli): add mega mcp install/repair/status/uninstall + e2e"
```

---

## Task 8b: Wire `buildMcpSetupOps` into the GUI bridge (F3 — production `mcpOps`)

> **Critic-locked (F3).** BB11's mcp-setup routes consume an
> injected `McpSetupOps`; `bb11-gui-doctor-design.md` §3 locks BB8
> as the owner that wires `buildMcpSetupOps(...)` into
> `apps/gui/bridge/server.ts`'s `createBridgeHandler` as the
> **production** default `mcpOps`. "There is no permanent BB11
> stub — once BB8 and BB11 both land, the GUI AgentSetupDoctor
> works end-to-end" (AA1 §1 F-MAJ-10). BB8 lands the wiring now;
> BB11 lands the routes that read `RouteContext.mcpOps`.

**Files:**
- Create: `apps/gui/bridge/mcp-ops.ts` — `createMcpOps(deps)` GUI-local facade construction.
- Modify: `apps/gui/bridge/handler.ts` — `BridgeHandlerOptions` + `RouteContext` gain optional `mcpOps`.
- Modify: `apps/gui/bridge/route-context.ts` — add `mcpOps?: McpSetupOps`.
- Modify: `apps/gui/bridge/server.ts` — build the real `mcpOps` and pass it to `createBridgeHandler`.
- Modify: `apps/gui/package.json` — add `@megasaver/mcp-bridge` + `@megasaver/connectors-shared` deps.
- Test: `apps/gui/bridge/mcp-ops.test.ts`

- [ ] **Step 1: Add GUI bridge deps**

Add to `apps/gui/package.json` `dependencies` (alphabetical):

```json
    "@megasaver/connectors-shared": "workspace:*",
    "@megasaver/core": "workspace:*",
    "@megasaver/mcp-bridge": "workspace:*",
    "@megasaver/shared": "workspace:*",
```

Run: `pnpm install`
Expected: workspace links resolve; no cycle (mcp-bridge → core → …; GUI → mcp-bridge is the existing apps-depend-on-packages arrow, AA1 §3).

- [ ] **Step 2: Write the failing `mcp-ops.test.ts`**

Create `apps/gui/bridge/mcp-ops.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpOps } from "./mcp-ops.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-05-13T00:00:00.000Z";

describe("createMcpOps (GUI production facade — F3)", () => {
  let home: string;
  let projectRoot: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "gui-mcp-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "gui-mcp-root-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function registryWithProject() {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: projectRoot,
      createdAt: TS,
      updatedAt: TS,
    });
    return registry;
  }

  it("status() returns four agent rows with connectorSynced + restartHint", async () => {
    const ops = createMcpOps({ registry: registryWithProject(), home, command: "mega-mcp" });
    const result = await ops.status();
    expect(result.agents).toHaveLength(4);
    expect(result.agents.every((a) => typeof a.restartHint === "string")).toBe(true);
  });

  it("install() writes the agent config (real primitive, not a stub)", async () => {
    const ops = createMcpOps({ registry: registryWithProject(), home, command: "mega-mcp" });
    await ops.install("claude-code", "demo");
    const raw = JSON.parse(
      await readFile(join(home, ".config", "claude", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, unknown> };
    expect(raw.mcpServers.megasaver).toBeDefined();
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `pnpm --filter @megasaver/gui test mcp-ops`
Expected: FAIL — `./mcp-ops.js` not found.

- [ ] **Step 4: Implement `mcp-ops.ts`**

Create `apps/gui/bridge/mcp-ops.ts`:

```ts
import { join } from "node:path";
import type { CoreRegistry } from "@megasaver/core";
import {
  parseBlock,
  readTargetFile,
  syncTargetBlock,
} from "@megasaver/connectors-shared";
import {
  buildMcpSetupOps,
  type KnownAgentId,
  type McpSetupOps,
} from "@megasaver/mcp-bridge";
import { KNOWN_TARGETS } from "./known-targets.js";
import { buildBridgeConnectorContext } from "./connector-context.js";

export type CreateMcpOpsDeps = {
  registry: CoreRegistry;
  home: string;
  command: string;
};

// F3: build the production McpSetupOps for the GUI bridge. The
// connectorSynced resolver + connectorSync side effect are GUI-local
// (over @megasaver/connectors-shared) so neither the GUI nor
// mcp-bridge imports the CLI (AA1 §3 arrow). Mirrors the CLI's
// resolver semantics so CLI and GUI agree.
export function createMcpOps(deps: CreateMcpOpsDeps): McpSetupOps {
  const targetFor = (agentId: KnownAgentId) =>
    KNOWN_TARGETS.find((t) => t.id === agentId) ?? null;

  return buildMcpSetupOps({
    home: deps.home,
    command: deps.command,
    connectorSyncedResolver: async (agentId) => {
      const target = targetFor(agentId);
      if (target === null) return false;
      // connectorSynced is project-scoped; the GUI resolves the
      // project root per agent's latest open session's project.
      const project = resolveProjectRoot(deps.registry, target.agentId);
      if (project === null) return false;
      const existing = await readTargetFile(join(project.rootPath, target.relativePath));
      return existing !== null && parseBlock(existing).block !== null;
    },
    connectorSync: async (agentId, projectName) => {
      const target = targetFor(agentId);
      if (target === null) return;
      const project = deps.registry
        .listProjects()
        .find((p) => p.name === projectName);
      if (project === undefined) return;
      const context = buildBridgeConnectorContext(deps.registry, target, project);
      await syncTargetBlock({
        absPath: join(project.rootPath, target.relativePath),
        context,
      });
    },
  });
}

// Latest project owning an open session for this agent; null if none.
function resolveProjectRoot(
  registry: CoreRegistry,
  agentId: string,
): { rootPath: string } | null {
  for (const project of registry.listProjects()) {
    const hasAgentSession = registry
      .listSessions(project.id)
      .some((s) => s.agentId === agentId);
    if (hasAgentSession) return { rootPath: project.rootPath };
  }
  return null;
}
```

> **BB11-coordination note.** `buildBridgeConnectorContext` and
> the GUI-local `known-targets.ts` re-export are small shims the
> GUI bridge needs to call `connectors-shared` `syncTargetBlock`
> without importing the CLI. If BB11 already lands a GUI connector
> context builder (its connector-block routes), reuse it instead
> of duplicating — this is the single BB8↔BB11 seam. For BB8 in
> isolation, the shim mirrors `apps/cli/.../connector/shared.ts`
> `buildConnectorContext`'s shape (project + sessions + memory →
> `ConnectorContext`). Keep it ≤ 40 LOC; if BB11 owns it first,
> delete the shim in the BB11 PR.

- [ ] **Step 5: Add the `mcpOps` slot to the handler + route context**

Edit `apps/gui/bridge/route-context.ts` — add the optional slot and the type import:

```ts
import type { McpSetupOps } from "@megasaver/mcp-bridge";
```

and add to the `RouteContext` type (after `registry`):

```ts
  // F3: BB8-built production facade; BB11's mcp-setup routes read it.
  mcpOps?: McpSetupOps;
```

Edit `apps/gui/bridge/handler.ts` — add to `BridgeHandlerOptions`:

```ts
  /** F3: production McpSetupOps; BB11 routes consume it via RouteContext. */
  mcpOps?: import("@megasaver/mcp-bridge").McpSetupOps;
```

and thread it into the per-request `RouteContext` construction (wherever the context object is assembled, add `mcpOps: options.mcpOps`).

- [ ] **Step 6: Wire the real `mcpOps` in `server.ts`**

Edit `apps/gui/bridge/server.ts` — import and build it, then pass to the handler:

```ts
import { createMcpOps } from "./mcp-ops.js";
```

and change the handler construction to:

```ts
  const mcpOps = createMcpOps({
    registry,
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    home: process.env["HOME"] ?? "",
    command: "mega-mcp",
  });
  const handler = createBridgeHandler({ registry, storePath: storeDir, mcpOps });
```

- [ ] **Step 7: Run — verify it passes**

Run: `pnpm --filter @megasaver/gui test mcp-ops`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/gui/bridge/mcp-ops.ts apps/gui/bridge/handler.ts apps/gui/bridge/route-context.ts apps/gui/bridge/server.ts apps/gui/bridge/mcp-ops.test.ts apps/gui/package.json pnpm-lock.yaml
git commit -m "feat(gui): wire production McpSetupOps into bridge handler"
```

> If `apps/gui/bridge/known-targets.ts` / `connector-context.ts`
> shims do not already exist, create them in this task (mirror the
> CLI equivalents; ≤ 40 LOC each) and add them to the `git add`
> above. They are the BB8↔BB11 seam flagged in Step 4.

---

## Task 9: recursive + policy-denied + unknown-tool unit coverage

**Files:**
- Create: `packages/mcp-bridge/test/run-command.recursive.test.ts`

> The e2e (Task 8) covers policy-denied + unknown-tool at the wire
> layer. This task adds the **recursive** case at the handler
> layer (deterministic, no wire) and asserts the
> `details.reason: recursive_megasaver` payload (AA1 §14 BB8,
> §8d step 4, §9a).

- [ ] **Step 1: Write the recursive test**

Create `packages/mcp-bridge/test/run-command.recursive.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRunCommand } from "../src/tools/run-command.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

describe("handleRunCommand recursion guard (AA1 §8d step 4, §9a)", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-rec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-rec-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("inherited originPid mismatching this process → command_denied: recursive_megasaver", async () => {
    const registry = seededRegistry(projectRoot);
    // originPid is some OTHER pid (not String(process.pid)) and
    // non-empty → the orchestrator's evaluateCommand returns
    // recursive_megasaver (AA1 §9a).
    const foreignPid = String(process.pid + 1);
    await expect(
      handleRunCommand(
        { registry, storeRoot: store, now: () => TS, newId: () => "x", originPid: foreignPid },
        { command: "ls", args: ["-a"], intent: "list", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({
      code: "command_denied",
      details: { reason: "recursive_megasaver" },
    });
  });
});
```

- [ ] **Step 2: Run — verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test run-command.recursive`
Expected: PASS (1 test). BB7b's `runOutputExecCommand` passes `originPid` into `evaluateCommand({ env: { MEGASAVER_ORIGIN_PID: input.originPid } })` (confirmed: `bb7b-output-exec-plan.md` Task 1) and returns `{ reason: "command_denied", code: "recursive_megasaver" }` when the marker mismatches `String(process.pid)` (AA1 §9a). The adapter maps `code` → `details.reason`, so the assertion above (`details: { reason: "recursive_megasaver" }`) holds.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-bridge/test/run-command.recursive.test.ts
git commit -m "test(mcp-bridge): recursive_megasaver guard at run-command tool"
```

---

## Task 10: Full verify + changeset

**Files:**
- Create: `.changeset/bb8-mcp-bridge.md`

- [ ] **Step 1: Run the full bridge package test suite**

Run: `pnpm --filter @megasaver/mcp-bridge test`
Expected: PASS — all of: `tool-name.test-d`, `errors.test-d`, `transport.test-d` (unchanged), `bridge.test`, `tools/fetch-chunk.test`, `tools/read-file.test`, `tools/run-command.test`, `tools/recall.test`, `setup/install.test`, `setup/setup-ops.test`, `server.e2e.test`, `run-command.recursive.test`.

- [ ] **Step 2: Run the CLI + GUI test suites**

Run: `pnpm --filter @megasaver/cli test mcp`
Expected: PASS (`mcp/install`, `mcp/status` — the latter asserts `connectorSynced`, F4).

Run: `pnpm --filter @megasaver/cli test json-failure-paths`
Expected: PASS (new mcp invalid-target rows green).

Run: `pnpm --filter @megasaver/gui test mcp-ops`
Expected: PASS (F3 production facade wiring — 2 tests).

- [ ] **Step 3: Add the changeset**

Create `.changeset/bb8-mcp-bridge.md`:

```md
---
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
widened to 16 members, McpToolName closed enum, the
`mega mcp install/repair/status/uninstall` CLI, and the
`McpSetupOps` facade (with `aggregateMcpStatus` reporting
`mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
per agent) wired into the GUI bridge as the production `mcpOps`.
Replaces the v0.3 not_implemented placeholder. createBridge API
preserved (AA1 §2c).
```

- [ ] **Step 4: Run the DoD gate**

Run: `pnpm verify`
Expected: PASS — lint (biome) clean, `tsc -b --noEmit` clean (all project references including the new mcp-bridge deps), full Vitest run green across the workspace.

- [ ] **Step 5: Commit**

```bash
git add .changeset/bb8-mcp-bridge.md
git commit -m "chore: changeset for BB8 mcp-bridge + mega mcp"
```

---

## CRITICAL completion gate (NOT a code step — AA1 §16, §15)

Do NOT claim "done"/"passing" before all hold (AA1 §16, `CLAUDE.md` §9):

- [ ] `architect` design memo authored in a fresh context (HIGH base).
- [ ] `critic` adversarial pass in a fresh context, AFTER implementation, BEFORE code-review.
- [ ] `tracer` enumerates spawn-path hypotheses (every branch that could spawn or skip the policy gate; note the bridge never spawns — the orchestrator does).
- [ ] `security-reviewer` PR-comment sign-off (severity-rated findings + mitigation status; OWASP command-injection + secret-leak checklist).
- [ ] `code-reviewer` pass in a fresh context (author ≠ reviewer).
- [ ] `verifier` evidence bundle: `pnpm verify` output + exit codes; the 16-member + 4-member pin assertions; the child-process whitelist verification (the exact `command` strings that reached `spawn()` during integration — sanity-check ALLOWED_COMMANDS coverage, AA1 §16); three distinct fresh-context session UUIDs (architect, critic, code-reviewer).
- [ ] **Manual user confirmation: user replies `confirm BB8 merge` verbatim** to a message linking the four artifacts above (AA1 §16).
- [ ] NO `autopilot` / `ralph` / unsupervised loops were used.

---

## Self-Review (run against the SPEC + AA1 §14 BB8)

**1. Spec coverage.**
- AA1 §8a four tools — Tasks 3 (fetch-chunk), 4 (read-file, run-command), 5 (recall). ✓
- AA1 §8b 16-member enum — Task 1 (widen + rewrite pin). ✓
- AA1 §8a `McpToolName` + pin — Task 2. ✓
- AA1 §2c `createBridge` preservation — Task 6 (transport readonly, start/stop `Promise<void>`, factory; DI slots added). ✓
- AA1 §8d `mega_run_command` flow + env marker — Task 4 (`run-command.ts` adapter; `originPid` resolved in `server.ts` `resolveOriginPid`, AA1 §8d step 3). ✓
- AA1 §8a path-gate order for `mega_read_file` — Task 4 reuses BB7a `runTwoGates` via `runOutputPipeline`. ✓
- AA1 §8c transport rollout (stdio ships, sse rejects `transport_failed`) — Task 6 bridge. ✓
- AA1 §5c `mega mcp` 4 subcommands + `--json` + idempotent install + repair=install+sync + per-agent `mcpInstalled`/`connectorSynced`/`restartRequired` — Tasks 7 (primitives), 7b (facade + `aggregateMcpStatus`), 8 (CLI; status routes through the shared aggregation, F4). ✓
- **F2 `McpSetupOps` facade (BB8-owned, BB11-consumed)** — Task 7b (`buildMcpSetupOps`/`McpStatusResult`). ✓
- **F4 `connectorSynced`** — Task 7b (`aggregateMcpStatus` field) + Task 8 Step 5b/6 (CLI resolver over `parseBlock`); ONE shared aggregation for CLI + GUI. ✓
- **F6 `restartHint`** (BB8-owned, per-agent) — Task 7b `restart-hint.ts`; claude-code/cursor confident, codex/aider generic with execution-time-confirm NOTE. ✓
- **F3 GUI production wiring** — Task 8b wires `buildMcpSetupOps(...)` into `apps/gui/bridge/server.ts` `createBridgeHandler` (replaces BB11 stub; AA1 §1 F-MAJ-10). ✓
- AA1 §14 BB8 acceptance (e2e run-command filtered; policy-denied → command_denied; recursive → command_denied:recursive_megasaver; unknown → tool_not_found) — Tasks 8 (e2e) + 9 (recursive unit). ✓
- AA1 §16 CRITICAL chain + `confirm BB8 merge` — header + completion gate. ✓
- AA1 §17 closed-enum rows (McpToolName new, McpBridgeErrorCode replaced, McpTransport unchanged) — Tasks 1, 2; transport pin untouched. ✓
- DoD (`pnpm verify` green; pins land; changeset) — Task 10. ✓

**2. Placeholder scan.** No "TBD"/"implement later"/"add error handling" without code. Every code step ships complete bodies. The two intentional forward-compat notes (`around` in fetch-chunk; `intent`-ranking in recall) are documented decisions with rationale, not stubs — both accept-and-thread the input; neither half-implements a branch.

**3. Type consistency.**
- `McpBridgeError` constructor gains `details?: { reason: string }` in Task 1 and is used with `details` in read-file/run-command (Task 4) and asserted in tests. ✓
- `handleRunCommand` env carries `originPid: string`; `server.ts` supplies it from `resolveOriginPid()`; the recursive test passes a foreign pid. ✓
- `runOutputPipeline` (BB7a, confirmed export) result discriminants (`session_not_found|path_denied|path_unsafe|file_read_failed`) — the read-file `switch` is exhaustive over them (verified against `run.ts`). ✓
- `runOutputExecCommand` (BB7b, authoritative export per `bb7b-output-exec-plan.md` Task 1) result union (`session_not_found | command_denied{code:PolicyDenyCode} | command_failed{detail} | store_write_failed{detail}`) drives the run-command `switch` — exhaustive, no `redaction_failed` branch (F1). `command_denied.code` (not `.detail`) feeds the wire `details.reason`. ✓
- `KnownAgentId` (mcp-bridge `agent-ids.ts`) mirrors CLI `KnownTargetId`; CLI validates via `isKnownTargetId` before calling into the bridge, so the cast is safe. ✓
- `ChunkSetSummary`, `Chunk`, `MemoryEntry`, `CoreRegistry`, `FilterOutputResult` all re-exported from `@megasaver/core` / `@megasaver/content-store` (verified against their `index.ts`). ✓

**Gaps fixed inline during review:**
- Task 4: the run-command test uses `ls -a` (allow-listed, AA1 §9b) directly — `echo` is a shell builtin and NOT in ALLOWED_COMMANDS.
- Task 8 `repair` requires `--project` because `runConnectorSync` is project-scoped — documented and flagged for reviewer (AA1 §5c left the project arg implicit).
- Task 6 Step 5: real `StdioServerTransport` attaching to `process.stdin` under Vitest — mitigation (inject a no-op transport factory for the unit lifecycle test; real stdio exercised by the e2e via `InMemoryTransport` and by hand at manual confirmation).
- **F1 (critic-locked):** bound the run-command adapter to BB7b's authoritative `runOutputExecCommand` + `RunOutputExecCommandResult` union — `command_denied` reads `.code` (PolicyDenyCode), added the `command_failed` branch, removed the bogus `redaction_failed` branch; the adapter returns `ExecResult`; supplies the required `timeoutMs`/`maxCaptureBytes` inputs (AA1 §8d step 5).
- **F2/F4/F6 (critic-locked):** BB8 now owns the `McpSetupOps` facade (Task 7b) returning `McpStatusResult` with `connectorSynced` (F4) + per-agent `restartHint` (F6); the `mega mcp status` CLI and the facade route through ONE shared aggregation (`aggregateMcpStatus`).
- **F3 (critic-locked):** Task 8b wires `buildMcpSetupOps(...)` into `apps/gui/bridge/server.ts` as the default `mcpOps`, replacing BB11's stub so the GUI AgentSetupDoctor works end-to-end (AA1 §1 F-MAJ-10).

**Dependency note (escalate if unmet):** BB7b's `run-command.ts` (`runOutputExecCommand`) must be merged before BB8 starts (Preconditions). The adapter binds to the exact authoritative union; if BB7b lands a divergent shape, the import + the single `switch` in `run-command.ts` are the only edits.

---

## Amendment — `mega mcp serve` launch entry (post-§16 smoke, 2026-06-03)

**Gap (found by the AA1 §16 live smoke).** `mega mcp install` wrote an
agent MCP config whose launch `command` defaulted to the literal
`"mega-mcp"`, but no such binary exists (the `apps/cli` `bin` is only
`mega`; there was no `serve` subcommand; `createBridge` is a library with
no process entry). So the configured server was unlaunchable and the AA1
§1 [A5] / §8 acceptance ("agent → stdio → bridge → `mega_run_command`")
could not run end-to-end. This amendment closes that gap.

**Shipped:**

- **`apps/cli/src/commands/mcp/serve.ts` — new `mega mcp serve` subcommand.**
  Resolves the store root + builds a `JsonDirectoryCoreRegistry` exactly
  as `mega output exec` does (`resolveStorePath` + `ensureStoreReady` from
  `apps/cli/src/store.ts`), then `createBridge({ transport: "stdio",
  storeRoot, registry })`, `await bridge.start()`, blocks until stdin
  closes / SIGINT / SIGTERM, `await bridge.stop()`, exits 0. Flag: `--store`
  (no `--json` — it is a long-running server, not a one-shot). A testable
  `runMcpServe(deps)` seam injects `createBridge` + a store/registry
  resolver + a `waitForShutdown` thunk, so the unit test starts/stops the
  bridge and asserts `transport:"stdio"` + the resolved `storeRoot`/
  `registry` WITHOUT attaching to real stdin (no hang). Registered in
  `apps/cli/src/commands/mcp/index.ts`.

- **Install/repair launch command rewired to be runnable.** `installMcp`
  (`packages/mcp-bridge/src/setup/install.ts`) now accepts optional
  `args?: string[]`, writes `{ command, args }` into
  `mcpServers[serverKey]`, and its idempotency check compares BOTH command
  AND args (re-install with the same pair is still a no-op; any drift is
  re-written). `repairMcp` threads `args` through. The CLI
  `install.ts`/`repair.ts` stop defaulting to `"mega-mcp"` and instead
  write `command: "mega"`, `args: ["mcp", "serve"]` (the real `mega` bin +
  the new subcommand), exported as `DEFAULT_MCP_COMMAND` /
  `DEFAULT_MCP_ARGS`; both remain overridable.

**Verification (this amendment).** TDD per change (failing test first);
unit tests cover the args-aware idempotency, the `runMcpServe` seam, and
the runnable-config shape. Live stdio smoke: `mega mcp serve` answered
`initialize` + `tools/list` (all four tools) and exited 0 on stdin EOF;
`mega_run_command ls -a` returned a filtered envelope with a real
`chunkSetId`; `rm -rf /` surfaced `command_denied: dangerous_pattern` —
i.e. the AA1 §1 [A5] / §8 acceptance now works end-to-end. `pnpm verify`
exits 0 (mcp-bridge 59, cli 400).

**Locked contracts preserved (unchanged by this amendment):**
`McpStatusResult` is still exactly 5 fields, the facade is still
`KnownAgentId`, the 16-member `McpBridgeErrorCode` enum + 4-member
`McpToolName` pins are untouched, and the `createBridge` config API
(transport / storeRoot / registry / now? / newId? / transportFactory?) is
unchanged — `serve` only *consumes* it.
