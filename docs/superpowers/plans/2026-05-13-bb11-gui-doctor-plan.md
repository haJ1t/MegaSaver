# BB11 — GUI AgentSetupDoctor + connector CONTEXT_GATE block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last AA1 epic PR — a GUI AgentSetupDoctor view that drives `mega mcp` install/repair/status/uninstall, plus an additive `MEGA SAVER:CONTEXT_GATE` connector block rendered only when a session has Mega Saver Mode enabled.

**Architecture:** Connector half extends `@megasaver/connectors-shared` with a second, independent sentinel pair: `parseBlock` becomes sentinel-parameterised (defaulting to the legacy pair so every existing caller is byte-unaffected), `upsertBlock` manages both blocks in one pass, and a new shared `renderContextGateBlock` emits the block only when `session.tokenSaver?.enabled === true`. GUI half mirrors BB10's `token-saver.ts` exactly: 4 zod-validated bridge routes under `/api/mcp/*` dispatched from `handler.ts`, thin wrappers over BB8's in-process setup ops (injected for testability), a self-contained `agent-setup-doctor` view, and an `agent-setup-row` presentation component, wired into the AA3-alphabetic nav.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest (+ jsdom + @testing-library/react for components), React (Vite), Node http bridge. Connector pkg: `@megasaver/connectors-shared`. GUI: `apps/gui`.

**Risk: MEDIUM** (epic §15). Pipeline (epic §16 MEDIUM): brainstorming → this plan → TDD → `executor` (sonnet) → `code-reviewer` (fresh context) → `verifier` (fresh context). Design gates (epic §6d, CLAUDE.md §5b) are mandatory checkpoints **in a fresh context**: `huashu-design` → `taste-skill` → `impeccable`, then `design:design-critique` + `design:accessibility-review` (author≠reviewer). Conventions are NOT touched (epic §18 item 4).

**Dependency note (READ BEFORE STARTING).** BB11 depends on **BB8** and **BB10** (epic §14). **Parent-locked ownership:** BB8 owns + exports the `McpSetupOps` facade + `McpStatusResult` type from `@megasaver/mcp-bridge`, AND wires `buildMcpSetupOps(...)` into `apps/gui/bridge/server.ts`'s `createBridgeHandler` as the production default `mcpOps`. BB11 is the **consumer**: it imports the facade type (Task 4 — does NOT redefine it), accepts an injected instance via `RouteContext.mcpOps` (so routes test with a fake), and renders whatever BB8 returns — including the per-agent `restartHint` (NOT hard-coded in BB11; see SPEC §3a). Once BB8 + BB11 both land, the AgentSetupDoctor works end-to-end. From BB10: GUI bridge dispatch wiring, `RouteContext.storeRoot`, `sendText`, api-client, `agentIdSchema` import in `zod-schemas.ts`. **Execution-ordering caveat:** if BB8 has not yet exported the facade type when BB11 starts, use the temporary `mcp-setup-types.ts` re-export shim (Task 4) and delete it the moment BB8's export lands — it is a build-unblocker, not a permanent stub (CLAUDE.md §13). The handler's no-injection fallback (Task 5) is a test-only empty-status object, never the product default.

---

## File Structure

**Connector package (`packages/connectors/shared/`):**
- `src/constants.ts` — MODIFY: append the two CG sentinel constants.
- `src/parse.ts` — MODIFY: `parseBlock(content, sentinels?)` parameterised; default = legacy pair (zero behaviour change for existing callers).
- `src/context-gate-block.ts` — CREATE: `renderContextGateBlock(context)` shared renderer (agent-agnostic).
- `src/upsert.ts` — MODIFY: `upsertBlock` manages legacy + CG blocks in one pass.
- `src/index.ts` — MODIFY: export new constants + `renderContextGateBlock`; widen `parseBlock` export (signature only).
- `test/context-gate-block.test.ts` — CREATE: renderer + CG-upsert isolation tests.
- `test/parse.test.ts` — MODIFY: add sentinel-parameter cases (legacy default unchanged).

**CLI test (`apps/cli/`):**
- `test/connector-byte-equality.test.ts` — MODIFY: loop over 4 tokenSaver permutations × targets.

**GUI bridge (`apps/gui/bridge/`):**
- `routes/mcp-setup.ts` — CREATE: 4 handlers + `dispatchMcpSetup`.
- `handler.ts` — MODIFY: import + dispatch `/api/mcp/*`.
- `route-context.ts` — MODIFY: add `mcpOps` injected slot.
- `zod-schemas.ts` — MODIFY: add `MEGA_MCP_TARGET_BODY`.
- `error-mapping.ts` — MODIFY: map BB8 setup errors → `mcp_setup_failed`.

**GUI src (`apps/gui/src/`):**
- `bridge-error-code.ts` — MODIFY: add `mcp_setup_failed` (alphabetic) + COPY.
- `lib/api-client.ts` — MODIFY: add mcp-setup client methods + types.
- `components/agent-setup-row.tsx` — CREATE: per-agent row (presentation + action).
- `views/agent-setup-doctor.tsx` — CREATE: self-contained doctor view.
- `view-id.ts` — MODIFY: add `"agent-setup"` (AA3 first) + label.
- `app.tsx` — MODIFY: render doctor branch (project-independent).

**GUI tests (`apps/gui/test/`):**
- `bridge-error-code.test-d.ts` — MODIFY: pin new tuple.
- `test/view-id.test-d.ts` — MODIFY: pin new VIEW_IDS tuple.
- `bridge/mcp-setup.test.ts` — CREATE: 4 routes + error paths.
- `components/agent-setup-row.test.tsx` — CREATE.
- `views/agent-setup-doctor.test.tsx` — CREATE.

---

## Task 1: CONTEXT_GATE renderer + constants

**Files:**
- Modify: `packages/connectors/shared/src/constants.ts`
- Create: `packages/connectors/shared/src/context-gate-block.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/context-gate-block.test.ts`

- [ ] **Step 1: Write the failing renderer test**

Create `packages/connectors/shared/test/context-gate-block.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
} from "../src/constants.js";
import { renderContextGateBlock } from "../src/context-gate-block.js";
import { buildContext } from "./fixtures.js";

const enabledTokenSaver = {
  enabled: true,
  mode: "balanced" as const,
  maxReturnedBytes: 12_000,
  storeRawOutput: true,
  redactSecrets: true,
  autoRepair: true,
  createdAt: "2026-05-07T12:00:00.000Z",
  updatedAt: "2026-05-07T12:00:00.000Z",
};

function ctxWithTokenSaver(tokenSaver: unknown) {
  const base = buildContext({ withSession: true });
  return { ...base, session: { ...base.session, tokenSaver } };
}

describe("renderContextGateBlock", () => {
  it("returns empty string when there is no session", () => {
    expect(renderContextGateBlock(buildContext())).toBe("");
  });

  it("returns empty string when tokenSaver is absent", () => {
    expect(renderContextGateBlock(buildContext({ withSession: true }))).toBe("");
  });

  it("returns empty string when tokenSaver.enabled is false", () => {
    expect(renderContextGateBlock(ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false }))).toBe(
      "",
    );
  });

  it("renders the block when enabled, with both sentinels", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    expect(block.startsWith(MEGA_SAVER_CG_BLOCK_START)).toBe(true);
    expect(block).toContain(MEGA_SAVER_CG_BLOCK_END);
    expect(block.endsWith("\n")).toBe(true);
  });

  it("substitutes session id, project id, mode and maxReturnedBytes", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    expect(block).toContain("Session: 22222222-2222-4222-8222-222222222222");
    expect(block).toContain("Project: 11111111-1111-4111-8111-111111111111");
    expect(block).toContain("Mode: balanced");
    expect(block).toContain("Max returned bytes: 12000");
  });

  it("mentions the four MCP tools and the intent rule", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    for (const tool of ["mega_read_file", "mega_run_command", "mega_fetch_chunk", "mega_recall"]) {
      expect(block).toContain(tool);
    }
    expect(block).toContain("Always pass `intent`");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connectors-shared test context-gate-block`
Expected: FAIL — `Cannot find module '../src/context-gate-block.js'` and missing `MEGA_SAVER_CG_BLOCK_*` exports.

- [ ] **Step 3: Append the CG sentinel constants**

In `packages/connectors/shared/src/constants.ts`, append after the existing two lines:

```ts
export const MEGA_SAVER_CG_BLOCK_START = "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->";
export const MEGA_SAVER_CG_BLOCK_END = "<!-- MEGA SAVER:CONTEXT_GATE END -->";
```

- [ ] **Step 4: Implement the renderer**

Create `packages/connectors/shared/src/context-gate-block.ts`:

```ts
import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "./constants.js";
import { type ConnectorContext, assertConnectorContext } from "./context.js";

// AA1 §7: rendered ONLY when session.tokenSaver?.enabled === true; otherwise "".
// Agent-agnostic (CLAUDE.md §1) — no per-agent branching. Trailing newline
// mirrors renderBlock (render.ts).
export function renderContextGateBlock(input: ConnectorContext): string {
  const context = assertConnectorContext(input);
  const tokenSaver = context.session?.tokenSaver;
  if (tokenSaver?.enabled !== true) {
    return "";
  }

  return [
    MEGA_SAVER_CG_BLOCK_START,
    "# Mega Saver Mode",
    "",
    "Mega Saver Mode is enabled for this session.",
    "",
    "When reading large files, running commands, or inspecting build /",
    "test output, prefer the Mega Saver MCP tools over native ones:",
    "",
    "- `mega_read_file(path, intent, ...)` over reading a whole file.",
    "- `mega_run_command(command, args, intent, ...)` over `Bash`.",
    "- `mega_fetch_chunk(chunkSetId, chunkId)` to drill into a stored",
    "  excerpt when the summary is insufficient.",
    "- `mega_recall(sessionId, intent)` to reload session memory and",
    "  recent tool calls without re-reading every file.",
    "",
    "Always pass `intent` — it drives ranking. Raw output is stored",
    "locally; ask for it only when the filtered result is genuinely",
    "insufficient.",
    "",
    `Session: ${context.session?.id}`,
    `Project: ${context.project.id}`,
    `Mode: ${tokenSaver.mode}`,
    `Max returned bytes: ${tokenSaver.maxReturnedBytes}`,
    MEGA_SAVER_CG_BLOCK_END,
    "",
  ].join("\n");
}
```

NOTE: `ConnectorContext` already carries `session: sessionSchema.nullable()`, and `sessionSchema` includes `tokenSaver?` (BB1, `packages/core/src/session.ts`). The `context.test.ts` fixtures may need `tokenSaver` permitted — it is `.optional()` so absent is fine; the test supplies it explicitly.

- [ ] **Step 5: Export from the barrel**

In `packages/connectors/shared/src/index.ts`, extend the constants re-export line and add the renderer:

```ts
export {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
} from "./constants.js";
export { renderContextGateBlock } from "./context-gate-block.js";
```

(Leave the other exports untouched; just replace the first `export { ... } from "./constants.js";` line with the 4-member form and add the renderer export.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @megasaver/connectors-shared test context-gate-block`
Expected: PASS — 6 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/shared/src/constants.ts packages/connectors/shared/src/context-gate-block.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/context-gate-block.test.ts
git commit -m "feat(connectors): add CONTEXT_GATE block renderer"
```

---

## Task 2: Parameterise parseBlock + upsertBlock for the second sentinel pair

**Files:**
- Modify: `packages/connectors/shared/src/parse.ts`
- Modify: `packages/connectors/shared/src/upsert.ts`
- Test: `packages/connectors/shared/test/parse.test.ts`, `packages/connectors/shared/test/context-gate-block.test.ts`

- [ ] **Step 1: Write the failing parse-parameterisation test**

Append to `packages/connectors/shared/test/parse.test.ts` (inside the existing `describe("parseBlock", ...)` block, before its closing `});`):

```ts
  it("default sentinels still parse the legacy pair (no behaviour change)", () => {
    const content = "intro\n<!-- MEGA SAVER:BEGIN -->\nbody\n<!-- MEGA SAVER:END -->\nafter\n";
    const parsed = parseBlock(content);
    expect(parsed.before).toBe("intro\n");
    expect(parsed.block).toContain("MEGA SAVER:BEGIN");
    expect(parsed.after).toBe("after\n");
  });

  it("parses a custom sentinel pair when provided", () => {
    const content =
      "x\n<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->\ncg\n<!-- MEGA SAVER:CONTEXT_GATE END -->\ny\n";
    const parsed = parseBlock(content, {
      start: "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->",
      end: "<!-- MEGA SAVER:CONTEXT_GATE END -->",
    });
    expect(parsed.before).toBe("x\n");
    expect(parsed.block).toContain("CONTEXT_GATE BEGIN");
    expect(parsed.after).toBe("y\n");
  });

  it("custom pair ignores the legacy pair entirely", () => {
    const content =
      "<!-- MEGA SAVER:BEGIN -->\nlegacy\n<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->\ncg\n<!-- MEGA SAVER:CONTEXT_GATE END -->\n";
    const parsed = parseBlock(content, {
      start: "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->",
      end: "<!-- MEGA SAVER:CONTEXT_GATE END -->",
    });
    expect(parsed.before).toBe("<!-- MEGA SAVER:BEGIN -->\nlegacy\n<!-- MEGA SAVER:END -->\n");
    expect(parsed.block).toContain("CONTEXT_GATE BEGIN");
  });
```

Also append to `packages/connectors/shared/test/context-gate-block.test.ts` a new describe for the two-block upsert:

```ts
import { upsertBlock } from "../src/upsert.js";

describe("upsertBlock — CONTEXT_GATE block management", () => {
  it("appends the CG block after the legacy block when enabled", () => {
    const ctx = ctxWithTokenSaver(enabledTokenSaver);
    const result = upsertBlock({ existingContent: "", context: ctx });
    expect(result).toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(result.indexOf("<!-- MEGA SAVER:BEGIN -->")).toBeLessThan(
      result.indexOf(MEGA_SAVER_CG_BLOCK_START),
    );
  });

  it("omits the CG block when disabled", () => {
    const ctx = ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false });
    const result = upsertBlock({ existingContent: "", context: ctx });
    expect(result).not.toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(result).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("removes a stale CG block when the session is now disabled", () => {
    const enabled = upsertBlock({
      existingContent: "",
      context: ctxWithTokenSaver(enabledTokenSaver),
    });
    expect(enabled).toContain(MEGA_SAVER_CG_BLOCK_START);
    const disabled = upsertBlock({
      existingContent: enabled,
      context: ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false }),
    });
    expect(disabled).not.toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(disabled).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("re-applying an enabled upsert is byte-identical (noop predicate)", () => {
    const once = upsertBlock({ existingContent: "", context: ctxWithTokenSaver(enabledTokenSaver) });
    const twice = upsertBlock({ existingContent: once, context: ctxWithTokenSaver(enabledTokenSaver) });
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connectors-shared test parse context-gate-block`
Expected: FAIL — `parseBlock` rejects the 2nd argument (TS error / runtime ignores it), and `upsertBlock` does not emit the CG block.

- [ ] **Step 3: Parameterise `parseBlock`**

In `packages/connectors/shared/src/parse.ts`, replace the imports + signature. Change line 1 and the `parseBlock` function head:

```ts
import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";

export interface ParsedBlock {
  before: string;
  block: string | null;
  after: string;
}

export interface SentinelPair {
  start: string;
  end: string;
}

const DEFAULT_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_BLOCK_START,
  end: MEGA_SAVER_BLOCK_END,
};

interface IndexedLine {
  text: string;
  raw: string;
}

export function parseBlock(content: string, sentinels: SentinelPair = DEFAULT_SENTINELS): ParsedBlock {
  const lines = splitIndexedLines(content);
  const starts = sentinelIndexes(lines, sentinels.start);
  const ends = sentinelIndexes(lines, sentinels.end);

  if (starts.length === 0 && ends.length === 0) {
    return { before: content, block: null, after: "" };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    throwBlockConflict(starts, ends);
  }

  const startIndex = starts[0] as number;
  const endIndex = ends[0] as number;
  if (endIndex < startIndex) {
    throwBlockConflict(starts, ends);
  }

  return {
    before: lines
      .slice(0, startIndex)
      .map((l) => l.raw)
      .join(""),
    block: lines
      .slice(startIndex, endIndex + 1)
      .map((l) => l.raw)
      .join(""),
    after: lines
      .slice(endIndex + 1)
      .map((l) => l.raw)
      .join(""),
  };
}
```

Leave `splitIndexedLines`, `sentinelIndexes`, `throwBlockConflict`, and the `export type { IndexedLine };` line exactly as they are. The default value reproduces today's behaviour byte-for-byte.

- [ ] **Step 4: Make `upsertBlock` manage both blocks**

Rewrite `packages/connectors/shared/src/upsert.ts`. Replace the imports and `upsertBlock` function; keep `removeBlock` and all helper functions (`joinWithManagedBlock`, `joinHumanContent`, `trimTrailingBoundaryLines`, `trimTrailingBoundaryForJoin`, `trimLeadingBoundaryLines`, `normalizedLineIsBlank`, `ensureTrailingNewline`, `detectDominantEol`) unchanged:

```ts
import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
} from "./constants.js";
import type { ConnectorContext } from "./context.js";
import { renderContextGateBlock } from "./context-gate-block.js";
import { type IndexedLine, type SentinelPair, parseBlock, splitIndexedLines } from "./parse.js";
import { renderBlock } from "./render.js";

interface UpsertBlockInput {
  existingContent: string;
  context: ConnectorContext;
}

const CG_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_CG_BLOCK_START,
  end: MEGA_SAVER_CG_BLOCK_END,
};

export function upsertBlock(input: UpsertBlockInput): string {
  const eol = detectDominantEol(input.existingContent);
  const normalized = input.existingContent.replace(/\r\n/g, "\n");

  // 1) Legacy block (default sentinels) — unchanged semantics.
  const legacyBlock = renderBlock(input.context);
  const afterLegacy = applyManagedBlock(normalized, legacyBlock);

  // 2) CONTEXT_GATE block — independent pair. Empty render ⇒ remove if present.
  const cgBlock = renderContextGateBlock(input.context);
  const result = applyOptionalBlock(afterLegacy, cgBlock, CG_SENTINELS);

  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

// Insert-or-replace the legacy managed block (default sentinels).
function applyManagedBlock(normalized: string, block: string): string {
  const parsed = parseBlock(normalized);
  if (parsed.block !== null) {
    return joinWithManagedBlock(parsed.before, parsed.after, block);
  }
  const humanContent = trimTrailingBoundaryForJoin(parsed.before);
  if (humanContent.length === 0) {
    return block;
  }
  return `${humanContent}\n\n${block}`;
}

// Insert-or-replace-or-remove a block under an explicit sentinel pair.
function applyOptionalBlock(
  normalized: string,
  block: string,
  sentinels: SentinelPair,
): string {
  const parsed = parseBlock(normalized, sentinels);
  if (block.length === 0) {
    if (parsed.block === null) return ensureTrailingNewline(normalized);
    const remaining = joinHumanContent(parsed.before, parsed.after);
    return remaining.trim().length === 0 ? "" : ensureTrailingNewline(remaining);
  }
  if (parsed.block !== null) {
    return joinWithManagedBlock(parsed.before, parsed.after, block);
  }
  const head = trimTrailingBoundaryForJoin(parsed.before);
  if (head.length === 0) return ensureTrailingNewline(block);
  return ensureTrailingNewline(`${head}\n\n${block}`);
}
```

NOTE: `renderBlock` ends with a trailing `\n` and `joinWithManagedBlock` calls `ensureTrailingNewline`; `applyManagedBlock` mirrors the original `upsertBlock` join logic exactly so legacy-only files stay byte-identical. `applyOptionalBlock` reuses the same helpers. The CG block (when present) is appended after the legacy block via the `head + \n\n + block` path because `afterLegacy` already has the legacy block in its `before`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/connectors-shared test`
Expected: PASS — all connector-shared tests green, including the original `upsert.test.ts` (legacy byte-stability preserved), `parse.test.ts` (new + old), `context-gate-block.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared/src/parse.ts packages/connectors/shared/src/upsert.ts packages/connectors/shared/test/parse.test.ts packages/connectors/shared/test/context-gate-block.test.ts
git commit -m "feat(connectors): parameterise parseBlock by sentinel pair"
```

---

## Task 3: Byte-equality fixtures for 4 tokenSaver permutations

**Files:**
- Modify: `apps/cli/test/connector-byte-equality.test.ts`

- [ ] **Step 1: Write the failing 4-permutation test**

Replace the body of `apps/cli/test/connector-byte-equality.test.ts` from the `for (const target of KNOWN_TARGETS)` loop onward. Keep the imports, constants (`PROJECT_ID`, `SESSION_ID`, `TS`), `describe`, `beforeEach`, `afterEach`, and `seedStore` — but extend `seedStore` to accept an optional `tokenSaver` field, and nest a permutation loop inside the target loop:

```ts
  const PERMUTATIONS = [
    { name: "tokenSaver absent", tokenSaver: undefined, hasCgBlock: false },
    {
      name: "tokenSaver disabled",
      tokenSaver: {
        enabled: false,
        mode: "balanced",
        maxReturnedBytes: 12_000,
        storeRawOutput: true,
        redactSecrets: true,
        autoRepair: true,
        createdAt: TS,
        updatedAt: TS,
      },
      hasCgBlock: false,
    },
    {
      name: "tokenSaver enabled balanced",
      tokenSaver: {
        enabled: true,
        mode: "balanced",
        maxReturnedBytes: 12_000,
        storeRawOutput: true,
        redactSecrets: true,
        autoRepair: true,
        createdAt: TS,
        updatedAt: TS,
      },
      hasCgBlock: true,
    },
    {
      name: "tokenSaver enabled safe",
      tokenSaver: {
        enabled: true,
        mode: "safe",
        maxReturnedBytes: 32_000,
        storeRawOutput: true,
        redactSecrets: true,
        autoRepair: true,
        createdAt: TS,
        updatedAt: TS,
      },
      hasCgBlock: true,
    },
  ] as const;

  for (const target of KNOWN_TARGETS) {
    for (const perm of PERMUTATIONS) {
      it(`${target.id} / ${perm.name}: re-applying upsertBlock is byte-identical`, async () => {
        await seedStore(target.agentId, perm.tokenSaver);
        const code = await runConnectorSync({
          projectName: "demo",
          targetFlag: target.id,
          storeFlag: store,
          cwd: projectRoot,
          home: "/tmp",
          xdgDataHome: undefined,
          stdout: () => {},
          stderr: () => {},
          json: false,
        });
        expect(code).toBe(0);

        const absPath = join(projectRoot, target.relativePath);
        const written = await readFile(absPath, "utf8");

        if (perm.hasCgBlock) {
          expect(written).toContain("<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->");
        } else {
          expect(written).not.toContain("<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->");
        }

        const project = {
          id: PROJECT_ID,
          name: "demo",
          rootPath: projectRoot,
          createdAt: TS,
          updatedAt: TS,
        };
        const sessions = [
          {
            id: SESSION_ID,
            projectId: PROJECT_ID,
            agentId: target.agentId,
            riskLevel: "medium" as const,
            title: null,
            startedAt: TS,
            endedAt: null,
            ...(perm.tokenSaver ? { tokenSaver: perm.tokenSaver } : {}),
          },
        ];
        const context = buildConnectorContext(target, project, sessions, []);
        const upserted = upsertBlock({ existingContent: written, context });
        expect(upserted).toBe(written);
      });
    }
  }
```

And update `seedStore` to write the tokenSaver into the seeded session:

```ts
  async function seedStore(agentId: string, tokenSaver?: unknown): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId,
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
          ...(tokenSaver ? { tokenSaver } : {}),
        },
      ]),
    );
  }
```

NOTE: `pickLatestOpenSession` selects the session by `endedAt === null && agentId === target.agentId`; the seeded session has `endedAt: null` and the per-target agentId, so the CG block reflects its tokenSaver. The byte-equality contract (re-apply == identity) is what proves render+upsert determinism across both blocks.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test connector-byte-equality`
Expected: FAIL initially only if Task 1/2 are not yet built; with Tasks 1–2 merged it should PASS. If run standalone before Tasks 1–2, FAIL with "CONTEXT_GATE BEGIN not found". (Execute Tasks 1→2→3 in order.)

- [ ] **Step 3: No implementation needed**

This task is test-only; the implementation lives in Tasks 1–2. If the test fails after Tasks 1–2, debug per `superpowers:systematic-debugging` (most likely: `buildConnectorContext` not forwarding `tokenSaver` — it forwards the whole `Session`, so confirm the seeded session object includes the field).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test connector-byte-equality`
Expected: PASS — `4 targets × 4 permutations = 16` byte-equality assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/connector-byte-equality.test.ts
git commit -m "test(cli): byte-equality across 4 tokenSaver permutations"
```

---

## Task 4: mcp-setup bridge routes (TDD, zod-validated)

**Files:**
- Modify: `apps/gui/bridge/route-context.ts`
- Modify: `apps/gui/bridge/zod-schemas.ts`
- Create: `apps/gui/bridge/routes/mcp-setup.ts`
- Test: `apps/gui/test/bridge/mcp-setup.test.ts`

**BB8 contract consumed (parent-locked; cite epic §5c).** BB8 **owns and
exports** the `McpSetupOps` facade + `McpStatusResult` type from
`@megasaver/mcp-bridge`, and wires `buildMcpSetupOps(...)` into
`apps/gui/bridge/server.ts`'s `createBridgeHandler` as the **production**
default `mcpOps`. BB11 is the consumer: `mcp-setup.ts` **imports** the facade
type (does NOT redefine it) and the routes accept it via the injected
`RouteContext` slot so they are unit-testable with a fake (epic §2c DI
precedent). There is no permanent BB11 stub — once BB8 + BB11 land, the GUI
AgentSetupDoctor works end-to-end. The locked facade (cite verbatim):

```ts
// Owned + exported by BB8 (@megasaver/mcp-bridge). target is an AgentId;
// install/repair take a project, uninstall does not; status takes no args.
export interface McpSetupOps {
  status(): Promise<McpStatusResult>;
  install(target: AgentId, project: string): Promise<McpStatusResult>;
  repair(target: AgentId, project: string): Promise<McpStatusResult>;
  uninstall(target: AgentId): Promise<McpStatusResult>;
}
export interface McpStatusResult {
  agents: Array<{
    agentId: AgentId;
    mcpInstalled: boolean;
    connectorSynced: boolean;
    restartRequired: boolean;
    restartHint: string;
  }>;
}
```

**Execution-ordering note.** BB11 depends on BB8 (epic §14). If BB8 has not
yet exported these types when BB11 starts, create a minimal
`apps/gui/bridge/routes/mcp-setup-types.ts` shim re-exporting the interface
above and delete it the moment BB8's export lands (the shim is a temporary
build-unblocker, not a permanent stub — CLAUDE.md §13). The steps below
import from `@megasaver/mcp-bridge`; swap to the shim path only if BB8 is
unmerged at execution time.

- [ ] **Step 1: Write the failing bridge-route test**

Create `apps/gui/test/bridge/mcp-setup.test.ts`:

```ts
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { McpSetupOps, McpStatusResult } from "@megasaver/mcp-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

const STATUS: McpStatusResult = {
  agents: [
    {
      agentId: "claude-code",
      mcpInstalled: false,
      connectorSynced: false,
      restartRequired: false,
      restartHint: "Restart Claude Code to load the Mega Saver MCP server.",
    },
  ],
};
const INSTALLED: McpStatusResult = {
  agents: [{ ...STATUS.agents[0], mcpInstalled: true, connectorSynced: true, restartRequired: true }],
};

function makeOps(): McpSetupOps {
  return {
    status: vi.fn(async () => STATUS),
    install: vi.fn(async () => INSTALLED),
    repair: vi.fn(async () => INSTALLED),
    uninstall: vi.fn(async () => STATUS),
  };
}

type TestServer = { baseUrl: string; ops: McpSetupOps; close(): Promise<void> };

async function startBridge(ops: McpSetupOps): Promise<TestServer> {
  const registry = createInMemoryCoreRegistry();
  const handler = createBridgeHandler({ registry, mcpOps: ops });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    ops,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("mcp-setup bridge routes", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startBridge(makeOps());
  });
  afterEach(async () => {
    if (server) await server.close();
  });

  it("GET /api/mcp/status returns the agents snapshot", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpStatusResult;
    expect(body.agents[0]?.agentId).toBe("claude-code");
    expect(server.ops.status).toHaveBeenCalledOnce();
  });

  it("POST /api/mcp/install passes target + project and returns the post-op snapshot", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "claude-code", project: "demo" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpStatusResult;
    expect(body.agents[0]?.mcpInstalled).toBe(true);
    expect(server.ops.install).toHaveBeenCalledWith("claude-code", "demo");
  });

  it("POST /api/mcp/repair passes target + project", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "cursor", project: "demo" }),
    });
    expect(res.status).toBe(200);
    expect(server.ops.repair).toHaveBeenCalledWith("cursor", "demo");
  });

  it("POST /api/mcp/uninstall passes target only", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/uninstall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "aider" }),
    });
    expect(res.status).toBe(200);
    expect(server.ops.uninstall).toHaveBeenCalledWith("aider");
  });

  it("rejects an unknown target with 400 validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "nonexistent", project: "demo" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("maps a setup-op throw to 500 mcp_setup_failed", async () => {
    const ops = makeOps();
    ops.install = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    await server.close();
    server = await startBridge(ops);
    const res = await fetch(`${server.baseUrl}/api/mcp/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "claude-code", project: "demo" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("mcp_setup_failed");
  });

  it("returns 405 for GET on a POST-only route", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/install`);
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test mcp-setup`
Expected: FAIL — `mcpOps` not accepted by `createBridgeHandler`; `routes/mcp-setup.js` missing.

- [ ] **Step 3: Add the zod body schema**

In `apps/gui/bridge/zod-schemas.ts`, `agentIdSchema` is already imported from
`@megasaver/shared` (BB10 form). Add the two body schemas near the other body
schemas (install/repair carry a `project`; uninstall does not — matching the
locked facade `install(target, project)` / `uninstall(target)`):

```ts
// MCP setup bodies (epic §6c). target is an AgentId; install/repair need the
// project whose agent files receive the connector block (epic §7).
export const MEGA_MCP_TARGET_BODY = z
  .object({
    target: agentIdSchema,
    project: z.string().min(1),
  })
  .strict();

export const MEGA_MCP_UNINSTALL_BODY = z
  .object({
    target: agentIdSchema,
  })
  .strict();
```

- [ ] **Step 4: Add the `mcpOps` slot to `RouteContext`**

In `apps/gui/bridge/route-context.ts`, add the type import (from BB8's package,
NOT a local route module) + field. After the `SendText` type and inside
`RouteContext`:

```ts
import type { McpSetupOps } from "@megasaver/mcp-bridge";
```

and add to the `RouteContext` type (after `sendText: SendText;`):

```ts
  mcpOps: McpSetupOps;
```

- [ ] **Step 5: Implement `routes/mcp-setup.ts`**

Create `apps/gui/bridge/routes/mcp-setup.ts`:

```ts
import type { AgentId } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { MEGA_MCP_TARGET_BODY, MEGA_MCP_UNINSTALL_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

// The McpSetupOps facade + McpStatusResult type are owned + exported by BB8
// (@megasaver/mcp-bridge); RouteContext.mcpOps carries an injected instance.
// BB11 does NOT redefine them — see route-context.ts import.

async function parseBody<T>(
  ctx: RouteContext,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: import("zod").ZodError } },
): Promise<T | null> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return null;
  }
  return parsed.data;
}

export async function handleMcpStatus(ctx: RouteContext): Promise<void> {
  try {
    ctx.sendJson(ctx.res, 200, await ctx.mcpOps.status(), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleMcpInstall(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: AgentId; project: string }>(ctx, MEGA_MCP_TARGET_BODY);
  if (data === null) return;
  try {
    ctx.sendJson(ctx.res, 200, await ctx.mcpOps.install(data.target, data.project), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleMcpRepair(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: AgentId; project: string }>(ctx, MEGA_MCP_TARGET_BODY);
  if (data === null) return;
  try {
    ctx.sendJson(ctx.res, 200, await ctx.mcpOps.repair(data.target, data.project), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleMcpUninstall(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: AgentId }>(ctx, MEGA_MCP_UNINSTALL_BODY);
  if (data === null) return;
  try {
    ctx.sendJson(ctx.res, 200, await ctx.mcpOps.uninstall(data.target), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

const MCP_PATH = /^\/api\/mcp\/(status|install|repair|uninstall)$/;

export async function dispatchMcpSetup(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  const match = path.match(MCP_PATH);
  if (!match) return false;
  const segment = match[1];

  const guard = (expected: string): boolean => {
    if (method === expected) return true;
    onMethodNotAllowed();
    return false;
  };

  if (segment === "status") {
    if (guard("GET")) await handleMcpStatus(ctx);
    return true;
  }
  if (segment === "install") {
    if (guard("POST")) await handleMcpInstall(ctx);
    return true;
  }
  if (segment === "repair") {
    if (guard("POST")) await handleMcpRepair(ctx);
    return true;
  }
  if (segment === "uninstall") {
    if (guard("POST")) await handleMcpUninstall(ctx);
    return true;
  }
  return false;
}
```

NOTE: `error-mapping.ts`'s existing fs-ErrnoException heuristic maps `EACCES`-style errors to `store_write_failed`, NOT `mcp_setup_failed`. Task 6 adds the explicit `mcp_setup_failed` mapping; until then this test's last assertion will report `store_write_failed`. Sequence: implement Task 6's error mapping BEFORE running this test's `mcp_setup_failed` case green. (The other 6 assertions pass with Tasks 4–5 alone.)

- [ ] **Step 6: Run test (expect partial pass; full pass after Task 6)**

Run: `pnpm --filter @megasaver/gui test mcp-setup`
Expected after Tasks 4–6: PASS — 7 tests green. (Task 5 wires the handler dispatch + `mcpOps` default; Task 6 the error code.)

- [ ] **Step 7: Commit**

```bash
git add apps/gui/bridge/routes/mcp-setup.ts apps/gui/bridge/route-context.ts apps/gui/bridge/zod-schemas.ts apps/gui/test/bridge/mcp-setup.test.ts
git commit -m "feat(gui): add mcp-setup bridge routes"
```

---

## Task 5: Handler dispatch registration + mcpOps default

**Files:**
- Modify: `apps/gui/bridge/handler.ts`
- Test: `apps/gui/test/bridge/mcp-setup.test.ts` (already written, Task 4)

- [ ] **Step 1: The failing test already exists (Task 4)**

The `mcp-setup.test.ts` passes `{ registry, mcpOps }` to `createBridgeHandler`. Until `handler.ts` accepts `mcpOps` and dispatches `/api/mcp/*`, the routes 404.

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter @megasaver/gui test mcp-setup`
Expected: FAIL — `mcpOps` is not on `BridgeHandlerOptions`; `/api/mcp/status` → 404 `route_not_found`.

- [ ] **Step 3: Wire `handler.ts`**

In `apps/gui/bridge/handler.ts` (BB10 form — which already imports `dispatchTokenSaver` and has `sendText`):

Add the imports near the other route imports (the facade type comes from BB8's
package; `dispatchMcpSetup` from the local route module):

```ts
import type { McpSetupOps } from "@megasaver/mcp-bridge";
import { dispatchMcpSetup } from "./routes/mcp-setup.js";
```

Add to `BridgeHandlerOptions` (after `storePath?`):

```ts
  /** In-process MCP setup ops, built + wired by BB8 (buildMcpSetupOps) in
   *  server.ts as the production default. Also injectable for tests. */
  mcpOps?: McpSetupOps;
```

In `createBridgeHandler`, after `const storePath = opts.storePath ?? "";`
resolve `mcpOps`. **Production wiring is BB8's job** (`server.ts` passes the
real `buildMcpSetupOps(...)`); the fallback below is a test-only
not-configured ops object for unit tests / smoke boots that construct the
handler without injecting `mcpOps`. It is NOT a permanent product stub —
production always supplies BB8's facade:

```ts
  // Test-only fallback when no ops injected; production server.ts (BB8)
  // always passes buildMcpSetupOps(...). Reports an empty agent list.
  const mcpOps: McpSetupOps =
    opts.mcpOps ??
    ({
      status: async () => ({ agents: [] }),
      install: async () => ({ agents: [] }),
      repair: async () => ({ agents: [] }),
      uninstall: async () => ({ agents: [] }),
    } satisfies McpSetupOps);
```

Add `mcpOps` to the `ctx` object literal (after `sendText,`):

```ts
      mcpOps,
```

Add the dispatch block — place it right after the existing token-saver dispatch block (`if (path.startsWith("/api/sessions/") && path.includes("/token-saver")) { ... }`) and before the `/api/memory` block:

```ts
    if (path.startsWith("/api/mcp/")) {
      const dispatched = await dispatchMcpSetup(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }
```

NOTE (production wiring, parent-locked): `apps/gui/bridge/server.ts` is wired
by **BB8** to pass `buildMcpSetupOps(...)` as `mcpOps` — BB8 owns that line.
BB11's handler change only adds the `mcpOps` option + dispatch; it does not
need to touch `server.ts`. Once BB8 + BB11 both land, the AgentSetupDoctor
works end-to-end against real agent config. The test-only fallback is a
legitimate empty-status response for handler constructions that omit ops
(not a half-implementation — CLAUDE.md §13).

- [ ] **Step 4: Run test to verify it passes (6/7; 7th needs Task 6)**

Run: `pnpm --filter @megasaver/gui test mcp-setup`
Expected: 6 PASS; the `mcp_setup_failed` assertion still reports `store_write_failed` until Task 6. Proceed to Task 6, then re-run for 7/7.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/bridge/handler.ts
git commit -m "feat(gui): dispatch /api/mcp routes with injected setup ops"
```

---

## Task 6: Bridge error code `mcp_setup_failed`

**Files:**
- Modify: `apps/gui/src/bridge-error-code.ts`
- Modify: `apps/gui/test/bridge-error-code.test-d.ts`
- Modify: `apps/gui/bridge/error-mapping.ts`
- Test: `apps/gui/test/bridge/mcp-setup.test.ts` (7th assertion)

- [ ] **Step 1: Update the failing tuple pin**

In `apps/gui/test/bridge-error-code.test-d.ts`, add `"mcp_setup_failed"` in alphabetic position to BOTH the tuple and the union. It sorts after `"internal_error"` and before `"method_not_allowed"` (m > i):

```ts
        "event_not_found",
        "internal_error",
        "mcp_setup_failed",
        "method_not_allowed",
```

(repeat the same insertion in the `BridgeErrorCode` union block below — `| "internal_error"` then `| "mcp_setup_failed"` then `| "method_not_allowed"`).

- [ ] **Step 2: Run the pin to verify it fails**

Run: `pnpm --filter @megasaver/gui test bridge-error-code`
Expected: FAIL — tuple type mismatch (`mcp_setup_failed` not in `BRIDGE_ERROR_CODES`).

- [ ] **Step 3: Add the code + COPY**

In `apps/gui/src/bridge-error-code.ts`, add `"mcp_setup_failed"` to `BRIDGE_ERROR_CODES` (after `internal_error`, alphabetic) and to `BRIDGE_ERROR_COPY`:

```ts
  internal_error: "Something went wrong. Try again.",
  mcp_setup_failed: "Agent setup failed. Check permissions and try again.",
  method_not_allowed: "Request method not allowed.",
```

- [ ] **Step 4: Map setup errors in `error-mapping.ts`**

In `apps/gui/bridge/error-mapping.ts`, `handleCaughtError` currently maps `E*` ErrnoExceptions to `store_write_failed`. For mcp-setup, the route's caught error should surface as `mcp_setup_failed`. Add a dedicated marker: in `mcp-setup.ts` route handlers, wrap setup-op failures so the mapper can distinguish them. Simplest surgical approach — add a sentinel error class consumed by the mapper.

Create the class in `error-mapping.ts` (top, after imports):

```ts
export class McpSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpSetupError";
  }
}
```

Add a branch in `handleCaughtError` BEFORE the ErrnoException heuristic:

```ts
  if (err instanceof McpSetupError) {
    sendError(res, 500, "mcp_setup_failed", err.message, origin);
    return;
  }
```

Then in `apps/gui/bridge/routes/mcp-setup.ts`, wrap each op call's catch to
rethrow as `McpSetupError`. Update the import (add `McpSetupError`;
`McpStatusResult` is still imported as a type from `@megasaver/mcp-bridge`):

```ts
import type { McpStatusResult } from "@megasaver/mcp-bridge";
import { McpSetupError, handleCaughtError } from "../error-mapping.js";
```

Add a shared wrapper:

```ts
async function runOp(
  ctx: RouteContext,
  op: () => Promise<McpStatusResult>,
): Promise<void> {
  try {
    ctx.sendJson(ctx.res, 200, await op(), ctx.origin);
  } catch (err) {
    handleCaughtError(
      ctx.res,
      ctx.origin,
      err instanceof McpSetupError ? err : new McpSetupError(err instanceof Error ? err.message : String(err), { cause: err }),
      ctx.sendError,
    );
  }
}
```

Then each handler's `try/catch` body becomes a `runOp` call, preserving the
two-arg install/repair and single-arg uninstall from Task 4:

```ts
export async function handleMcpStatus(ctx: RouteContext): Promise<void> {
  await runOp(ctx, () => ctx.mcpOps.status());
}

export async function handleMcpInstall(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: AgentId; project: string }>(ctx, MEGA_MCP_TARGET_BODY);
  if (data === null) return;
  await runOp(ctx, () => ctx.mcpOps.install(data.target, data.project));
}

export async function handleMcpRepair(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: AgentId; project: string }>(ctx, MEGA_MCP_TARGET_BODY);
  if (data === null) return;
  await runOp(ctx, () => ctx.mcpOps.repair(data.target, data.project));
}

export async function handleMcpUninstall(ctx: RouteContext): Promise<void> {
  const data = await parseBody<{ target: AgentId }>(ctx, MEGA_MCP_UNINSTALL_BODY);
  if (data === null) return;
  await runOp(ctx, () => ctx.mcpOps.uninstall(data.target));
}
```

NOTE: this keeps the validation path (`parseBody` returns null → already
responded) intact; only the op-execution failure is remapped to
`mcp_setup_failed`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/gui test bridge-error-code mcp-setup`
Expected: PASS — pin green; all 7 mcp-setup assertions green (including `mcp_setup_failed`).

- [ ] **Step 6: Commit**

```bash
git add apps/gui/src/bridge-error-code.ts apps/gui/test/bridge-error-code.test-d.ts apps/gui/bridge/error-mapping.ts apps/gui/bridge/routes/mcp-setup.ts
git commit -m "feat(gui): add mcp_setup_failed bridge error code"
```

---

## Task 7: api-client methods

**Files:**
- Modify: `apps/gui/src/lib/api-client.ts`
- Test: covered indirectly via Task 8/9 component tests (fetch-stubbed). No standalone test file (matches BB10 — api-client functions are thin and exercised through components).

- [ ] **Step 1: Add the client types + methods**

Append to `apps/gui/src/lib/api-client.ts` (after the token-saver section):

```ts
// ── MCP setup endpoints (BB11) ──────────────────────────────────────────────
// Shapes mirror BB8's McpStatusResult (agentId only — no separate `target`
// field). install/repair carry the active project (epic §7 — the connector
// block is written into that project's agent files); uninstall + status do not.

export type McpAgentStatus = {
  agentId: string;
  mcpInstalled: boolean;
  connectorSynced: boolean;
  restartRequired: boolean;
  restartHint: string;
};
export type McpStatusResponse = { agents: McpAgentStatus[] };

export function fetchMcpStatus(): Promise<McpStatusResponse> {
  return getJson<McpStatusResponse>("/api/mcp/status");
}

export function installMcp(target: string, project: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/install", { target, project });
}

export function repairMcp(target: string, project: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/repair", { target, project });
}

export function uninstallMcp(target: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/uninstall", { target });
}
```

- [ ] **Step 2: Typecheck to verify it compiles**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/gui/src/lib/api-client.ts
git commit -m "feat(gui): add mcp-setup api-client methods"
```

---

## Task 8: agent-setup-row component (TDD)

**Files:**
- Create: `apps/gui/src/components/agent-setup-row.tsx`
- Test: `apps/gui/test/components/agent-setup-row.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `apps/gui/test/components/agent-setup-row.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSetupRow } from "../../src/components/agent-setup-row.js";
import type { McpAgentStatus } from "../../src/lib/api-client.js";

const base: McpAgentStatus = {
  agentId: "claude-code",
  mcpInstalled: false,
  connectorSynced: false,
  restartRequired: false,
  restartHint: "Restart Claude Code to load the Mega Saver MCP server.",
};

afterEach(cleanup);

describe("AgentSetupRow", () => {
  it("shows a Set up action when not installed", () => {
    render(<AgentSetupRow agent={base} busy={false} projectSelected onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /Set up/i })).toBeDefined();
  });

  it("shows a Repair action when installed but not synced", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: false }}
        busy={false}
        projectSelected
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Repair/i })).toBeDefined();
  });

  it("surfaces the restart hint when restartRequired", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: true, restartRequired: true }}
        busy={false}
        projectSelected
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Restart Claude Code/i)).toBeDefined();
  });

  it("fires onAction with the right verb on click", () => {
    const onAction = vi.fn();
    render(<AgentSetupRow agent={base} busy={false} projectSelected onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /Set up/i }));
    expect(onAction).toHaveBeenCalledWith("install");
  });

  it("renders the agent id", () => {
    render(<AgentSetupRow agent={base} busy={false} projectSelected onAction={() => {}} />);
    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("disables install/repair and shows a hint when no project is selected", () => {
    render(<AgentSetupRow agent={base} busy={false} projectSelected={false} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /Set up/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Pick a project/i)).toBeDefined();
  });

  it("does NOT gate uninstall on project selection", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: true, restartRequired: false }}
        busy={false}
        projectSelected={false}
        onAction={() => {}}
      />,
    );
    // Ready state → Uninstall, which needs no project.
    expect(screen.getByRole("button", { name: /Uninstall/i }).hasAttribute("disabled")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test agent-setup-row`
Expected: FAIL — `Cannot find module '../../src/components/agent-setup-row.js'`.

- [ ] **Step 3: Implement the row component**

Create `apps/gui/src/components/agent-setup-row.tsx`:

```tsx
import type { McpAgentStatus } from "../lib/api-client.js";

export type McpAction = "install" | "repair" | "uninstall";

type AgentSetupRowProps = {
  agent: McpAgentStatus;
  busy: boolean;
  /** Whether a project is selected in the app shell. install/repair (which
   *  write into a project's agent files, epic §7) are gated on this; uninstall
   *  and status are not. */
  projectSelected: boolean;
  onAction: (action: McpAction) => void;
};

type RowState = {
  label: string;
  tone: "muted" | "warn" | "ok";
  action: McpAction | null;
  actionLabel: string;
};

function deriveState(agent: McpAgentStatus): RowState {
  if (!agent.mcpInstalled) {
    return { label: "Not installed", tone: "muted", action: "install", actionLabel: "Set up" };
  }
  if (!agent.connectorSynced) {
    return { label: "Config missing", tone: "warn", action: "repair", actionLabel: "Repair" };
  }
  if (agent.restartRequired) {
    return { label: "Restart required", tone: "warn", action: null, actionLabel: "" };
  }
  return { label: "Ready", tone: "ok", action: "uninstall", actionLabel: "Uninstall" };
}

const TONE: Record<RowState["tone"], string> = {
  muted: "text-text-muted",
  warn: "text-danger",
  ok: "text-accent",
};

export function AgentSetupRow({
  agent,
  busy,
  projectSelected,
  onAction,
}: AgentSetupRowProps): JSX.Element {
  const state = deriveState(agent);
  const isDestructive = state.action === "uninstall";
  const needsProject = state.action === "install" || state.action === "repair";
  const projectGated = needsProject && !projectSelected;
  const disabled = busy || projectGated;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-text-primary">{agent.agentId}</span>
          <span className={`text-xs ${TONE[state.tone]}`}>{state.label}</span>
        </div>
        {state.action && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => state.action && onAction(state.action)}
            className={[
              "rounded-md px-4 py-1.5 text-sm cursor-pointer transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              isDestructive
                ? "border border-danger/40 text-danger hover:bg-danger/5"
                : "bg-accent text-accent-fg hover:opacity-90",
            ].join(" ")}
          >
            {busy ? "Working…" : state.actionLabel}
          </button>
        )}
      </div>
      {projectGated && (
        <p className="text-xs text-text-muted">Pick a project to install or repair.</p>
      )}
      {agent.restartRequired && agent.restartHint.length > 0 && (
        <p className="text-xs text-text-muted">{agent.restartHint}</p>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test agent-setup-row`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/components/agent-setup-row.tsx apps/gui/test/components/agent-setup-row.test.tsx
git commit -m "feat(gui): add agent-setup-row component"
```

---

## Task 9: agent-setup-doctor view (TDD)

**Files:**
- Create: `apps/gui/src/views/agent-setup-doctor.tsx`
- Test: `apps/gui/test/views/agent-setup-doctor.test.tsx`

- [ ] **Step 1: Write the failing view test**

Create `apps/gui/test/views/agent-setup-doctor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSetupDoctor } from "../../src/views/agent-setup-doctor.js";

const NOT_INSTALLED = {
  agents: [
    {
      agentId: "claude-code",
      mcpInstalled: true,
      connectorSynced: false,
      restartRequired: false,
      restartHint: "Restart Claude Code to load the MCP server.",
    },
  ],
};
const REPAIRED = {
  agents: [{ ...NOT_INSTALLED.agents[0], connectorSynced: true, restartRequired: true }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentSetupDoctor", () => {
  it("loads and lists agents with a Repair action when config is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => NOT_INSTALLED })),
    );
    render(<AgentSetupDoctor activeProjectId="demo" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Repair/i })).toBeDefined(),
    );
  });

  it("repairs on click (passing the project) and re-fetches, surfacing the restart hint", async () => {
    const fetchMock = vi
      .fn()
      // initial status
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => NOT_INSTALLED })
      // POST repair (returns post-op snapshot)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => REPAIRED })
      // re-fetch status after mutation
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => REPAIRED });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentSetupDoctor activeProjectId="demo" />);
    await waitFor(() => screen.getByRole("button", { name: /Repair/i }));
    fireEvent.click(screen.getByRole("button", { name: /Repair/i }));

    await waitFor(() => expect(screen.getByText(/Restart Claude Code/i)).toBeDefined());
    // repair POST carried the active project in its body.
    const repairCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/mcp/repair"));
    expect(JSON.parse((repairCall?.[1] as RequestInit).body as string)).toEqual({
      target: "claude-code",
      project: "demo",
    });
  });

  it("disables Repair when no project is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => NOT_INSTALLED })),
    );
    render(<AgentSetupDoctor activeProjectId={null} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Repair/i }).hasAttribute("disabled")).toBe(true),
    );
    expect(screen.getByText(/Pick a project/i)).toBeDefined();
  });

  it("shows an error state when the status fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom", code: "mcp_setup_failed" }),
      })),
    );
    render(<AgentSetupDoctor activeProjectId="demo" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test agent-setup-doctor`
Expected: FAIL — `Cannot find module '../../src/views/agent-setup-doctor.js'`.

- [ ] **Step 3: Implement the view**

Create `apps/gui/src/views/agent-setup-doctor.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSetupRow, type McpAction } from "../components/agent-setup-row.js";
import { ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import {
  type McpAgentStatus,
  fetchMcpStatus,
  installMcp,
  repairMcp,
  uninstallMcp,
} from "../lib/api-client.js";

type AgentSetupDoctorProps = {
  // From the app shell. install/repair need a project (epic §7); null disables
  // those actions. Status + uninstall do not depend on it.
  activeProjectId: string | null;
};

export function AgentSetupDoctor({ activeProjectId }: AgentSetupDoctorProps): JSX.Element {
  const [agents, setAgents] = useState<McpAgentStatus[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const status = await fetchMcpStatus();
      setAgents(status.agents);
      setLoadState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function runAction(agentId: string, action: McpAction): Promise<void> {
    // install/repair require a project; the row disables them when none is
    // selected, so this guard is belt-and-suspenders.
    if ((action === "install" || action === "repair") && activeProjectId === null) return;
    setBusyAgent(agentId);
    setError(null);
    try {
      if (action === "install") await installMcp(agentId, activeProjectId as string);
      else if (action === "repair") await repairMcp(agentId, activeProjectId as string);
      else await uninstallMcp(agentId);
      await load();
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setBusyAgent(null);
    }
  }

  return (
    <section aria-label="Agent setup" className="flex flex-col gap-6 px-6 py-6 overflow-y-auto">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-text-primary">Agent setup</h2>
        <p className="text-sm text-text-muted">
          Install and repair the Mega Saver MCP server for each connected agent.
        </p>
      </header>

      {loadState === "loading" && <LoadingState label="Checking agent setup…" />}

      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorState error={error} onRetry={() => void load()} />
        </div>
      )}

      {loadState === "ready" && (
        <ul className="flex flex-col gap-3">
          {agents.map((agent) => (
            <AgentSetupRow
              key={agent.agentId}
              agent={agent}
              busy={busyAgent === agent.agentId}
              projectSelected={activeProjectId !== null}
              onAction={(action) => void runAction(agent.agentId, action)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test agent-setup-doctor`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/agent-setup-doctor.tsx apps/gui/test/views/agent-setup-doctor.test.tsx
git commit -m "feat(gui): add agent-setup-doctor view"
```

---

## Task 10: Wire the view into app nav

**Files:**
- Modify: `apps/gui/src/view-id.ts`
- Modify: `apps/gui/test/view-id.test-d.ts`
- Modify: `apps/gui/src/app.tsx`

- [ ] **Step 1: Update the failing view-id pin**

In `apps/gui/test/view-id.test-d.ts`, update the pinned tuple to the new AA3-alphabetic order. Read the file first to match its exact `expectTypeOf` shape, then change `["memory", "sessions"]` → `["agent-setup", "memory", "sessions"]` in both the tuple and any union assertion.

- [ ] **Step 2: Run the pin to verify it fails**

Run: `pnpm --filter @megasaver/gui test view-id`
Expected: FAIL — tuple mismatch (`agent-setup` missing from `VIEW_IDS`).

- [ ] **Step 3: Add the view id + label**

In `apps/gui/src/view-id.ts`:

```ts
// Order: alphabetic (matches AA3 convention for human-facing closed enums).
export const VIEW_IDS = ["agent-setup", "memory", "sessions"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-setup": "Agent setup",
  memory: "Memory entries",
  sessions: "Sessions",
};
```

- [ ] **Step 4: Render the doctor branch in `app.tsx`**

In `apps/gui/src/app.tsx`, add the import:

```ts
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
```

The doctor view always renders (status loads regardless of project); it
receives `activeProjectId` and gates its own install/repair actions when none
is selected (SPEC §7). So render it OUTSIDE the project-gated `showContent`
guard, passing the current `activeProjectId`. Add this branch immediately
inside `<main>`, before the `showProjectsLoading` block:

```tsx
        {view === "agent-setup" ? (
          <AgentSetupDoctor activeProjectId={activeProjectId} />
        ) : (
          <>
            {showProjectsLoading && <LoadingState label="Connecting to bridge…" />}
            {showProjectsError && projectsError && (
              <ErrorState error={projectsError} onRetry={retryProjects} />
            )}
            {showNoProjects && <NoProjectState />}
            {showNoSelection && (
              <div className="px-4 py-8 text-sm text-text-muted">Pick a project to begin.</div>
            )}
            {showContent && (
              <>
                {view === "sessions" && (
                  <SessionsView
                    projectId={activeProjectId as string}
                    initialSelectedId={pendingSessionId}
                    onClearInitialId={() => setPendingSessionId(null)}
                  />
                )}
                {view === "memory" && (
                  <MemoryView projectId={activeProjectId as string} onViewSession={handleViewSession} />
                )}
              </>
            )}
          </>
        )}
```

(This wraps the existing project-gated content in the `else` arm; only `agent-setup` bypasses the project gate. Read `app.tsx` first and splice precisely — keep all existing state/handlers.)

- [ ] **Step 5: Run the full GUI suite to verify it passes**

Run: `pnpm --filter @megasaver/gui test`
Expected: PASS — view-id pin green; existing app-flow integration tests still green (the nav now has 3 tabs; if `app-flow.test.tsx` asserts exact tab count, update that assertion to 3 — read it first).

- [ ] **Step 6: Commit**

```bash
git add apps/gui/src/view-id.ts apps/gui/test/view-id.test-d.ts apps/gui/src/app.tsx
git commit -m "feat(gui): add Agent setup tab to nav"
```

---

## Final verification

- [ ] **Step 1: Full verify across the two packages**

Run: `pnpm --filter @megasaver/connectors-shared test`
Expected: PASS — renderer, parse (legacy + custom), upsert (legacy byte-stable + CG), all green.

Run: `pnpm --filter @megasaver/cli test connector-byte-equality`
Expected: PASS — 16 assertions (4 targets × 4 permutations).

Run: `pnpm --filter @megasaver/gui test`
Expected: PASS — mcp-setup routes (7), agent-setup-row (7), agent-setup-doctor (4), both `.test-d` pins, all existing GUI tests.

- [ ] **Step 2: Repo-wide DoD gate**

Run: `pnpm verify`
Expected: PASS — lint + typecheck + test green across the workspace, including `pnpm conventions:check` with no diff (epic §18 item 4 — BB11 touches no conventions).

- [ ] **Step 3: Design gates (fresh context, epic §6d)**

Confirm `design:design-critique` + `design:accessibility-review` PASS on `agent-setup-doctor` + `agent-setup-row` in a SEPARATE context (CLAUDE.md §9.6 author≠reviewer). These are mandatory MEDIUM checkpoints, not separate PRs.

- [ ] **Step 4: Changeset**

```bash
pnpm changeset
```

Add a minor changeset for `@megasaver/connectors-shared` (new public export `renderContextGateBlock` + CG sentinel constants + widened `parseBlock` signature) and `@megasaver/gui` (new bridge routes + view). CLAUDE.md §9 item 9.

---

## Self-Review

**1. Spec coverage.** Walked SPEC §1–§10 against tasks:
- §2a sentinel constants → Task 1 Step 3. ✓
- §2b CG block content (verbatim) → Task 1 Step 4 (every line of the epic §7 block reproduced). ✓
- §2c parse parameterisation (default = legacy, zero regression) → Task 2 Step 3; upsert two-block management → Task 2 Step 4. ✓
- §2d byte-equality 4 permutations → Task 3. ✓
- §3 four mcp-setup routes (GET status, POST install/repair/uninstall) consuming BB8's locked `McpSetupOps` facade; install/repair carry `project`, uninstall does not; two zod bodies → Tasks 4–6. ✓
- §3a restart-required wording **consumed from BB8** (`McpStatusResult.agents[].restartHint`), rendered by the row when present — NOT hard-coded in BB11 (post-critic F6). ✓
- §4 doctor view states (not installed / config missing / restart / ready) → Task 8 `deriveState` + Task 9 view. ✓
- §5 `mcp_setup_failed` error code; unknown target → validation_failed → Task 6 + Task 4 test. ✓
- §6 file-size budget (view < 200 LOC via row split) → Tasks 8/9 separate files. ✓
- §7 nav AA3 ordering + project-gated install/repair → Task 10 + Tasks 8/9 `projectSelected`. ✓
- §8 design chain → Final verification Step 3. ✓
- §9 DoD → Final verification Steps 1–4. ✓

**2. Placeholder scan.** No "TBD/TODO/implement later". Every code step shows complete code. The `NOTE` blocks (Task 4 BB8-export-ordering shim; Task 5 production wiring; Task 6 error-mapping sequencing) describe real, non-placeholder behaviour. **F2/F3 (post-critic):** BB11 no longer redefines `McpSetupOps` — it imports the parent-locked facade from `@megasaver/mcp-bridge` (BB8). The handler's no-injection fallback is explicitly a test-only empty-status object, NOT a permanent product stub; production wiring (`buildMcpSetupOps` in `server.ts`) is BB8-owned, so the doctor works end-to-end once both land.

**3. Type consistency.** Bridge side imports BB8's `McpSetupOps` + `McpStatusResult` (Tasks 4–6) — no local redefinition. GUI side (api-client, Task 7) defines `McpStatusResponse` / `McpAgentStatus` structurally mirroring BB8's agent shape (`agentId` only — the stale `target` field is removed everywhere: Tasks 4, 7, 8, 9 fixtures + impls). Facade arg arity is consistent end-to-end: `install(target, project)` / `repair(target, project)` / `uninstall(target)` / `status()` — bridge handlers (Task 4/6), zod bodies (`MEGA_MCP_TARGET_BODY` has `{target, project}`, `MEGA_MCP_UNINSTALL_BODY` has `{target}`), api-client (`installMcp(target, project)` etc.), and the view's `runAction` (threads `activeProjectId` into install/repair, guards null). `McpAction` defined once (Task 8), imported by the view (Task 9). `projectSelected` prop flows app → view → row; row gates only install/repair, never uninstall/status. `dispatchMcpSetup` signature matches `dispatchTokenSaver`. `parseBlock(content, sentinels?)` default reproduces legacy behaviour — every existing caller untouched; `SentinelPair` exported from `parse.ts`, consumed by `upsert.ts`. `renderContextGateBlock` name consistent across SPEC §2b, Task 1, Task 2, index export.

**Gaps found & fixed inline:**
- (a) `upsertBlock` calling `parseBlock` twice without threading the legacy result — fixed by `applyManagedBlock` → `afterLegacy` → `applyOptionalBlock` pipeline so the CG block lands after the legacy block.
- (b) Task 6 ordering: the generic ErrnoException heuristic would mis-map setup failures to `store_write_failed`; fixed with an explicit `McpSetupError` wrapper so the mapper distinguishes them; 6/7→7/7 test sequencing noted across Tasks 4–6.
- (c) **Post-critic F2/F3/F6/F7 pass:** aligned the consumer side to BB8's locked facade (`install/repair/status/uninstall` names + arg arities; removed the `target` field); dropped the permanent-stub framing; switched `restartHint` to consumed-from-BB8; fixed the alphabetic-position prose (`mcp_setup_failed` sorts after `internal_error`, before `method_not_allowed`).
- (d) **Project-coupling reconciliation:** the locked facade's `install(target, project)` / `repair(target, project)` require a project, which contradicted the earlier "doctor is fully project-independent" framing. Reconciled: status + uninstall stay project-free and always available; install/repair are gated on a selected project (`projectSelected` prop disables the button + shows "Pick a project" hint; the view also guards `runAction`). The app passes `activeProjectId` into the doctor.
