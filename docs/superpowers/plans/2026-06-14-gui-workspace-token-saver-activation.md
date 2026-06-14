# GUI Workspace-Scoped Token Saver Activation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-scoped (cwd) "Saver Mode" activation control to the live GUI that genuinely turns MegaSaver compression on/off end-to-end for Claude sessions in that folder, by writing the `MEGA SAVER:CONTEXT_GATE` block into `<cwd>/CLAUDE.md`.

**Architecture:** Engine Option A (render-in-bridge). The bridge derives the real cwd server-side from the selected session's transcript (`resolveSessionWorkspace`), persists `{enabled, mode}` to a cwd-keyed store file, and upserts only the CONTEXT_GATE block into `<cwd>/CLAUDE.md` through the existing sentinel-bounded, atomic, symlink-refusing connector write helpers. The toggle reports MCP-install status (read via `mcpOps.status()`) but does not install MCP — that stays AgentSetupDoctor's job. No core registry, no MegaSaver "projects".

**Tech Stack:** TypeScript (strict, ESM), React + Vite (GUI), Node http bridge, Zod, Vitest, `@megasaver/connectors-shared`, `@megasaver/shared`, `@megasaver/mcp-bridge`.

**Plan supersedes spec §5.1:** the spec proposed a client-supplied `cwd` validated against surfaced workspaces. This plan uses a strictly safer mechanism — the cwd is **never** client-supplied; it is derived server-side from the session transcript via the existing `resolveSessionWorkspace` traversal guard (400/404). The route therefore lives under the session path: `/api/claude-sessions/:dir/:id/token-saver/workspace`.

**Naming note:** the new workspace activation tab is labelled **"Saver Mode"** (maps to the product term "Mega Saver Mode") to avoid visual collision with the existing session-scoped **"Token saver"** stats tab, which is unchanged.

**Known cosmetic:** the rendered block's static line "enabled for this session" and its `Session:`/`Project:` identity lines are reused verbatim from the existing per-session renderer. For the workspace path the identity lines show `Session: (workspace-wide)` / `Project: <workspace label>`. This is an instruction block for the agent; the wording is harmless and kept identical to preserve DRY.

---

## File Structure

**Modify:**
- `packages/connectors/shared/src/context-gate-block.ts` — extract pure `renderContextGateBlockText(fields)`; `renderContextGateBlock` delegates to it (output byte-identical).
- `packages/connectors/shared/src/upsert.ts` — add `upsertContextGateBlockText(existingContent, block)` (CONTEXT_GATE-only upsert; reuses the existing private `applyOptionalBlock`).
- `packages/connectors/shared/src/index.ts` — export the two new functions.
- `apps/gui/bridge/routes/claude-session-token-saver.ts` — add the `workspace` GET/POST handlers + extend the dispatcher regex and method handling.
- `apps/gui/src/lib/claude-sessions-client.ts` — add `WorkspaceSaverStatus` type + `fetchWorkspaceSaver` / `setWorkspaceSaver`.
- `apps/gui/src/cockpit/panel-registry.ts` — register `ws-token-saver`.
- `apps/gui/test/components/cockpit-panel-registry.test.tsx` — update the expected id-order assertion.
- `apps/gui/src/views/cockpit/token-saver-panel.tsx` — one-line pointer that activation is the workspace "Saver Mode" tab.

**Create:**
- `packages/connectors/shared/test/context-gate-text.test.ts`
- `apps/gui/src/views/cockpit/workspace-saver-mode-panel.tsx`
- `apps/gui/src/cockpit/panels/workspace-saver-mode-cockpit-panel.tsx`
- `apps/gui/test/bridge/workspace-saver-route.test.ts`
- `apps/gui/test/components/workspace-saver-mode-panel.test.tsx`
- `.changeset/gui-workspace-saver-mode.md`

---

## Task 1: connectors-shared render/upsert text helpers

**Files:**
- Modify: `packages/connectors/shared/src/context-gate-block.ts`
- Modify: `packages/connectors/shared/src/upsert.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/context-gate-text.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/connectors/shared/test/context-gate-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  renderContextGateBlockText,
  upsertContextGateBlockText,
} from "../src/index.js";

const block = (mode = "balanced", bytes = 12_000) =>
  renderContextGateBlockText({
    sessionId: "(workspace-wide)",
    projectId: "my-app",
    mode,
    maxReturnedBytes: bytes,
  });

describe("renderContextGateBlockText", () => {
  it("renders a sentinel-bounded block carrying mode + budget + identity", () => {
    const out = block("aggressive", 4_000);
    expect(out.startsWith(MEGA_SAVER_CG_BLOCK_START)).toBe(true);
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_END);
    expect(out).toContain("Mode: aggressive");
    expect(out).toContain("Max returned bytes: 4000");
    expect(out).toContain("Session: (workspace-wide)");
    expect(out).toContain("Project: my-app");
  });
});

describe("upsertContextGateBlockText", () => {
  it("inserts the block when absent and preserves human content", () => {
    const out = upsertContextGateBlockText("# My notes\n\nhello\n", block());
    expect(out).toContain("# My notes");
    expect(out).toContain("hello");
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_START);
  });

  it("is idempotent — applying twice yields identical output", () => {
    const once = upsertContextGateBlockText("# My notes\n", block());
    const twice = upsertContextGateBlockText(once, block());
    expect(twice).toBe(once);
  });

  it("removes the block on empty render and restores surrounding content", () => {
    const withBlock = upsertContextGateBlockText("# My notes\n\nhello\n", block());
    const removed = upsertContextGateBlockText(withBlock, "");
    expect(removed).not.toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(removed).toContain("# My notes");
    expect(removed).toContain("hello");
  });

  it("leaves a pre-existing legacy MEGA_SAVER block untouched", () => {
    const legacy = `${MEGA_SAVER_BLOCK_START}\nlegacy body\n${MEGA_SAVER_BLOCK_END}\n`;
    const out = upsertContextGateBlockText(legacy, block());
    expect(out).toContain(MEGA_SAVER_BLOCK_START);
    expect(out).toContain("legacy body");
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_START);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connectors-shared exec vitest run test/context-gate-text.test.ts`
Expected: FAIL — `renderContextGateBlockText` / `upsertContextGateBlockText` are not exported.

- [ ] **Step 3: Extract `renderContextGateBlockText` in `context-gate-block.ts`**

Replace the file body with (static lines unchanged so existing `renderContextGateBlock` output stays byte-identical):

```ts
import { type TokenSaverMode } from "@megasaver/shared";
import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "./constants.js";
import { type ConnectorContext, assertConnectorContext } from "./context.js";

export type ContextGateBlockFields = {
  sessionId: string;
  projectId: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number;
};

// Pure block text. Shared by the per-session connector render
// (renderContextGateBlock) and the GUI workspace activation path.
export function renderContextGateBlockText(fields: ContextGateBlockFields): string {
  return [
    MEGA_SAVER_CG_BLOCK_START,
    "# Mega Saver Mode",
    "",
    "Mega Saver Mode is enabled for this session.",
    "",
    "When reading large files, running commands, or inspecting build /",
    "test output, prefer the Mega Saver MCP tools over native ones:",
    "",
    "- `proxy_read_file(path, intent, ...)` over reading a whole file.",
    "- `proxy_run_command(command, args, intent, ...)` over `Bash`.",
    "- `proxy_expand_chunk(chunkSetId, chunkId)` to drill into a stored",
    "  excerpt when the summary is insufficient.",
    "- `mega_recall(sessionId, intent)` to reload session memory and",
    "  recent tool calls without re-reading every file.",
    "",
    "Always pass `intent` — it drives ranking. Raw output is stored",
    "locally; ask for it only when the filtered result is genuinely",
    "insufficient.",
    "",
    "Prefer proxy tools for reading files, searching code, running tests,",
    "running typecheck, inspecting build logs, and reviewing diffs.",
    "Use native tools only when explicitly required.",
    "Expand chunks before assuming omitted content is irrelevant.",
    "",
    `Session: ${fields.sessionId}`,
    `Project: ${fields.projectId}`,
    `Mode: ${fields.mode}`,
    `Max returned bytes: ${fields.maxReturnedBytes}`,
    MEGA_SAVER_CG_BLOCK_END,
    "",
  ].join("\n");
}

// AA1 §7: rendered ONLY when session.tokenSaver?.enabled === true; otherwise "".
export function renderContextGateBlock(input: ConnectorContext): string {
  const context = assertConnectorContext(input);
  const session = context.session;
  if (session?.tokenSaver?.enabled !== true) {
    return "";
  }
  return renderContextGateBlockText({
    sessionId: session.id,
    projectId: context.project.id,
    mode: session.tokenSaver.mode,
    maxReturnedBytes: session.tokenSaver.maxReturnedBytes,
  });
}
```

- [ ] **Step 4: Add `upsertContextGateBlockText` in `upsert.ts`**

Add this exported function (place it directly after `upsertBlock`, so it can use the existing private `applyOptionalBlock`, `CG_SENTINELS`, and `detectDominantEol`):

```ts
// CONTEXT_GATE-only upsert. Unlike upsertBlock, it never touches the legacy
// managed block — used by the GUI workspace activation path, which has no
// connector context. Empty block ⇒ remove the CG block if present.
export function upsertContextGateBlockText(existingContent: string, block: string): string {
  const eol = detectDominantEol(existingContent);
  const normalized = existingContent.replace(/\r\n/g, "\n");
  const result = applyOptionalBlock(normalized, block, CG_SENTINELS);
  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}
```

- [ ] **Step 5: Export both from `index.ts`**

Change the `renderContextGateBlock` export line and the `upsert` export line:

```ts
export { renderContextGateBlock, renderContextGateBlockText } from "./context-gate-block.js";
```
```ts
export { removeBlock, upsertBlock, upsertContextGateBlockText } from "./upsert.js";
```

- [ ] **Step 6: Run the new test + the full connectors-shared suite (regression gate)**

Run: `pnpm --filter @megasaver/connectors-shared test`
Expected: PASS — new `context-gate-text.test.ts` green AND all pre-existing tests (75 baseline) still green (proves the `renderContextGateBlock` refactor is byte-identical).

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/shared/src/context-gate-block.ts packages/connectors/shared/src/upsert.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/context-gate-text.test.ts
git commit -m "feat(connectors-shared): extract CONTEXT_GATE text + CG-only upsert"
```

---

## Task 2: bridge — rebuild connectors-shared, then add workspace settings store + handlers

**Files:**
- Modify: `apps/gui/bridge/routes/claude-session-token-saver.ts`
- Test: `apps/gui/test/bridge/workspace-saver-route.test.ts`

> The bridge imports the new functions from `@megasaver/connectors-shared`'s built `dist/`. Rebuild that package first so the import resolves.

- [ ] **Step 1: Rebuild connectors-shared**

Run: `pnpm --filter @megasaver/connectors-shared build`
Expected: build success (emits updated `dist/index.js` with the new exports).

- [ ] **Step 2: Write the failing route test**

Create `apps/gui/test/bridge/workspace-saver-route.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const DIR = "ws-dir";
const ID = "wssess01";
const CG_START = "MEGA_SAVER_CG_BLOCK_START"; // substring assertion only

let projectsDir: string;
let metaDir: string;
let cwd: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "wsv-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "wsv-meta-"));
  cwd = mkdtempSync(join(tmpdir(), "wsv-cwd-")); // real, writable workspace dir
  seedWorkspaceCwd({ projectsDir, metaDir, cwd, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

const url = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/token-saver/workspace`;

describe("workspace token-saver activation route", () => {
  it("GET defaults to disabled with no block and reports mcpInstalled=false", async () => {
    server = await start();
    const res = await fetch(url());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.blockPresent).toBe(false);
    expect(body.mcpInstalled).toBe(false);
  });

  it("POST enabled=true writes the CONTEXT_GATE block into <cwd>/CLAUDE.md", async () => {
    server = await start();
    const res = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, mode: "aggressive" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.blockPresent).toBe(true);
    const claudeMd = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain(CG_START);
    expect(claudeMd).toContain("Mode: aggressive");
  });

  it("POST enabled=false removes the block again", async () => {
    server = await start();
    await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, mode: "balanced" }),
    });
    const res = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, mode: "balanced" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).blockPresent).toBe(false);
    const claudeMd = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
    expect(claudeMd).not.toContain(CG_START);
  });

  it("POST with an invalid mode → 400 validation_failed", async () => {
    server = await start();
    const res = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, mode: "turbo" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("traversal dir → 400 validation_failed", async () => {
    server = await start();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/token-saver/workspace`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown session → 404 claude_session_not_found", async () => {
    server = await start();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/${DIR}/nope/token-saver/workspace`,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });

  it("PUT → 405 method_not_allowed", async () => {
    server = await start();
    const res = await fetch(url(), { method: "PUT" });
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/workspace-saver-route.test.ts`
Expected: FAIL — the `/token-saver/workspace` route is not handled (404 for GET, etc.).

- [ ] **Step 4: Add settings store + handlers + dispatcher in `claude-session-token-saver.ts`**

Add these imports at the top (merge with the existing import block):

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  MEGA_SAVER_CG_BLOCK_START,
  readTargetFile,
  renderContextGateBlockText,
  upsertContextGateBlockText,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { type TokenSaverMode, modeToBudget, tokenSaverModeSchema, workspaceLabel } from "@megasaver/shared";
import { z } from "zod";
import { readJsonBody } from "./_body.js";
```

Add the settings store + body schema (after the existing `readOverlaySettings` helper):

```ts
const workspaceSaverSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: tokenSaverModeSchema,
  updatedAt: z.string(),
});
type WorkspaceSaverSettings = z.infer<typeof workspaceSaverSettingsSchema>;

const WORKSPACE_SAVER_BODY = z
  .object({ enabled: z.boolean(), mode: tokenSaverModeSchema })
  .strict();

const DISABLED_DEFAULT: WorkspaceSaverSettings = {
  enabled: false,
  mode: "balanced",
  updatedAt: "",
};

function workspaceSaverSettingsPath(ctx: RouteContext, wk: string): string {
  return join(ctx.storeRoot, "stats", wk, "workspace-token-saver.json");
}

// Boundary read (§8): a missing or malformed settings file reads as disabled
// rather than crashing.
function readWorkspaceSaverSettings(ctx: RouteContext, wk: string): WorkspaceSaverSettings {
  const path = workspaceSaverSettingsPath(ctx, wk);
  if (!existsSync(path)) return DISABLED_DEFAULT;
  try {
    const parsed = workspaceSaverSettingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : DISABLED_DEFAULT;
  } catch {
    return DISABLED_DEFAULT;
  }
}

async function claudeMcpInstalled(ctx: RouteContext): Promise<boolean> {
  const status = await ctx.mcpOps.status();
  return status.agents.find((a) => a.agentId === "claude-code")?.mcpInstalled ?? false;
}

async function claudeMdHasBlock(cwd: string): Promise<boolean> {
  const existing = await readTargetFile(join(cwd, "CLAUDE.md"));
  return existing !== null && existing.includes(MEGA_SAVER_CG_BLOCK_START);
}

export async function handleWorkspaceSaverStatus(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    const settings = readWorkspaceSaverSettings(ctx, resolved.workspaceKey);
    const blockPresent = await claudeMdHasBlock(resolved.cwd);
    const mcpInstalled = await claudeMcpInstalled(ctx);
    ctx.sendJson(
      ctx.res,
      200,
      { enabled: settings.enabled, mode: settings.mode, blockPresent, mcpInstalled },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleWorkspaceSaverSet(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;

  let raw: unknown;
  try {
    raw = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = WORKSPACE_SAVER_BODY.safeParse(raw);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      "Invalid token-saver settings.",
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }

  try {
    const { enabled, mode } = parsed.data;

    // 1) Persist cwd-keyed settings in the store (never in the user repo).
    const settingsPath = workspaceSaverSettingsPath(ctx, resolved.workspaceKey);
    mkdirSync(dirname(settingsPath), { recursive: true });
    await writeTargetFile({
      absPath: settingsPath,
      content: JSON.stringify({ enabled, mode, updatedAt: ctx.now() }),
    });

    // 2) Upsert the CONTEXT_GATE block into <cwd>/CLAUDE.md (sentinel-bounded,
    //    atomic, symlink-refusing). Skip writing when disabling and no file
    //    exists, so we never create an empty CLAUDE.md.
    const claudeMdPath = join(resolved.cwd, "CLAUDE.md");
    const existing = await readTargetFile(claudeMdPath);
    const block = enabled
      ? renderContextGateBlockText({
          sessionId: "(workspace-wide)",
          projectId: workspaceLabel(resolved.cwd),
          mode,
          maxReturnedBytes: modeToBudget(mode),
        })
      : "";
    if (!(block === "" && existing === null)) {
      const next = upsertContextGateBlockText(existing ?? "", block);
      await writeTargetFile({ absPath: claudeMdPath, content: next });
    }

    const blockPresent = await claudeMdHasBlock(resolved.cwd);
    const mcpInstalled = await claudeMcpInstalled(ctx);
    ctx.sendJson(ctx.res, 200, { enabled, mode, blockPresent, mcpInstalled }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
```

> `TokenSaverMode` is imported for type clarity; if Biome flags it as unused (the handlers infer it), drop it from the import. Keep `modeToBudget`, `tokenSaverModeSchema`, `workspaceLabel`.

- [ ] **Step 5: Extend the dispatcher regex + method handling**

Change the path regex to include `workspace`:

```ts
const SESSION_TOKEN_SAVER_PATH =
  /^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/token-saver(?:\/(status|stats|events|workspace)(?:\/([^/]+)\/(raw|sent))?)?$/;
```

Replace the body of `dispatchSessionTokenSaver` (the part after `const blob = match[5];`) with:

```ts
  if (segment === "workspace") {
    if (method === "GET") {
      await handleWorkspaceSaverStatus(ctx, dir, id);
      return true;
    }
    if (method === "POST") {
      await handleWorkspaceSaverSet(ctx, dir, id);
      return true;
    }
    onMethodNotAllowed();
    return true;
  }

  if (method !== "GET") {
    onMethodNotAllowed();
    return true;
  }

  if (segment === "status") {
    await handleSessionTokenSaverStatus(ctx, dir, id);
    return true;
  }
  if (segment === "stats") {
    await handleSessionTokenSaverStats(ctx, dir, id);
    return true;
  }
  if (segment === "events" && eventId === undefined) {
    await handleSessionTokenSaverEvents(ctx, dir, id);
    return true;
  }
  if (segment === "events" && eventId !== undefined && (blob === "raw" || blob === "sent")) {
    await handleSessionTokenSaverEventBlob(ctx, dir, id, decodeURIComponent(eventId));
    return true;
  }
  return false;
}
```

(Delete the original top-of-function `if (method !== "GET") { onMethodNotAllowed(); return true; }` guard — it is now handled per-segment above.)

- [ ] **Step 6: Run the route test to verify it passes**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/workspace-saver-route.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 7: Run the existing token-saver route test (regression)**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/claude-session-token-saver-route.test.ts`
Expected: PASS (the read-only routes still behave; method handling moved but GET paths unchanged).

- [ ] **Step 8: Commit**

```bash
git add apps/gui/bridge/routes/claude-session-token-saver.ts apps/gui/test/bridge/workspace-saver-route.test.ts
git commit -m "feat(gui): workspace token-saver activation bridge route"
```

---

## Task 3: GUI client functions

**Files:**
- Modify: `apps/gui/src/lib/claude-sessions-client.ts`

- [ ] **Step 1: Add the type + two client functions**

After the existing `fetchSessionTokenSaverEvents` function, add:

```ts
export type WorkspaceSaverStatus = {
  enabled: boolean;
  mode: "aggressive" | "balanced" | "safe";
  blockPresent: boolean;
  mcpInstalled: boolean;
};

export function fetchWorkspaceSaver(dir: string, id: string): Promise<WorkspaceSaverStatus> {
  return getJson<WorkspaceSaverStatus>(`${tokenSaverBase(dir, id)}/workspace`);
}

export function setWorkspaceSaver(
  dir: string,
  id: string,
  input: { enabled: boolean; mode: "aggressive" | "balanced" | "safe" },
): Promise<WorkspaceSaverStatus> {
  return mutateJson<WorkspaceSaverStatus>(`${tokenSaverBase(dir, id)}/workspace`, "POST", input);
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @megasaver/gui exec tsc -b --noEmit`
Expected: no errors (confirms `getJson`/`mutateJson`/`tokenSaverBase` signatures match).

- [ ] **Step 3: Commit**

```bash
git add apps/gui/src/lib/claude-sessions-client.ts
git commit -m "feat(gui): client fns for workspace saver activation"
```

---

## Task 4: GUI Saver Mode panel + cockpit adapter + registry

**Files:**
- Create: `apps/gui/src/views/cockpit/workspace-saver-mode-panel.tsx`
- Create: `apps/gui/src/cockpit/panels/workspace-saver-mode-cockpit-panel.tsx`
- Modify: `apps/gui/src/cockpit/panel-registry.ts`
- Modify: `apps/gui/test/components/cockpit-panel-registry.test.tsx`
- Test: `apps/gui/test/components/workspace-saver-mode-panel.test.tsx`

- [ ] **Step 1: Write the failing panel test**

Create `apps/gui/test/components/workspace-saver-mode-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSaverStatus } from "../../src/lib/claude-sessions-client.js";

const stub: {
  fetch: () => Promise<WorkspaceSaverStatus>;
  set: (i: { enabled: boolean; mode: string }) => Promise<WorkspaceSaverStatus>;
} = {
  fetch: () => Promise.reject(new Error("not set")),
  set: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchWorkspaceSaver: () => stub.fetch(),
  setWorkspaceSaver: (_d: string, _i: string, input: { enabled: boolean; mode: string }) =>
    stub.set(input),
}));

import { WorkspaceSaverModePanel } from "../../src/views/cockpit/workspace-saver-mode-panel.js";

const DISABLED: WorkspaceSaverStatus = {
  enabled: false,
  mode: "balanced",
  blockPresent: false,
  mcpInstalled: true,
};

afterEach(() => {
  cleanup();
  stub.fetch = () => Promise.reject(new Error("not set"));
  stub.set = () => Promise.reject(new Error("not set"));
});

describe("WorkspaceSaverModePanel", () => {
  it("renders the current disabled status", async () => {
    stub.fetch = () => Promise.resolve(DISABLED);
    render(<WorkspaceSaverModePanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByLabelText(/Saver Mode/i)).toBeDefined());
    expect((screen.getByLabelText(/Saver Mode/i) as HTMLInputElement).checked).toBe(false);
  });

  it("enabling calls setWorkspaceSaver with the selected mode", async () => {
    stub.fetch = () => Promise.resolve(DISABLED);
    const calls: Array<{ enabled: boolean; mode: string }> = [];
    stub.set = (input) => {
      calls.push(input);
      return Promise.resolve({ ...DISABLED, enabled: true, blockPresent: true });
    };
    render(<WorkspaceSaverModePanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByLabelText(/Saver Mode/i)).toBeDefined());
    fireEvent.click(screen.getByLabelText(/Saver Mode/i));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({ enabled: true, mode: "balanced" });
  });

  it("warns when enabled but MCP is not installed", async () => {
    stub.fetch = () =>
      Promise.resolve({ enabled: true, mode: "balanced", blockPresent: true, mcpInstalled: false });
    render(<WorkspaceSaverModePanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByText(/has no effect/i)).toBeDefined());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/gui exec vitest run test/components/workspace-saver-mode-panel.test.tsx`
Expected: FAIL — `WorkspaceSaverModePanel` does not exist.

- [ ] **Step 3: Create the panel `workspace-saver-mode-panel.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type WorkspaceSaverStatus,
  fetchWorkspaceSaver,
  setWorkspaceSaver,
} from "../../lib/claude-sessions-client.js";

const MODES = ["aggressive", "balanced", "safe"] as const;

export function WorkspaceSaverModePanel({
  dir,
  id,
}: {
  dir: string;
  id: string;
  cwd: string;
}): JSX.Element {
  const [status, setStatus] = useState<WorkspaceSaverStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setStatus(await fetchWorkspaceSaver(dir, id));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [dir, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (enabled: boolean, mode: WorkspaceSaverStatus["mode"]) => {
      setBusy(true);
      try {
        setStatus(await setWorkspaceSaver(dir, id, { enabled, mode }));
      } catch (err) {
        setError(err as BridgeError);
        setState("error");
      } finally {
        setBusy(false);
      }
    },
    [dir, id],
  );

  return (
    <section
      aria-label="Workspace saver mode"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Saver Mode</h2>
      <p className="text-xs text-text-muted">
        Activation is workspace-wide: it writes the Mega Saver block into this folder's CLAUDE.md
        and applies to every Claude session in the same directory.
      </p>
      {state === "loading" && <LoadingState label="Loading saver mode…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && status && (
        <>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              aria-label="Saver Mode"
              checked={status.enabled}
              disabled={busy}
              onChange={(e) => void apply(e.target.checked, status.mode)}
            />
            Saver Mode {status.enabled ? "on" : "off"}
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            Mode
            <select
              aria-label="Compression budget"
              value={status.mode}
              disabled={busy}
              onChange={(e) =>
                void apply(status.enabled, e.target.value as WorkspaceSaverStatus["mode"])
              }
              className="rounded-md border border-border bg-surface-elevated px-2 py-1"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-md border border-border bg-surface-elevated">
              CLAUDE.md block: {status.blockPresent ? "present" : "absent"}
            </span>
            <span className="px-2 py-1 rounded-md border border-border bg-surface-elevated">
              MCP bridge: {status.mcpInstalled ? "installed" : "not installed"}
            </span>
          </div>
          {status.enabled && !status.mcpInstalled && (
            <p className="text-xs text-danger">
              MCP bridge is not installed for Claude Code. Install it from the Agent Setup tab —
              Saver Mode has no effect until the proxy tools are available.
            </p>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Create the cockpit adapter `workspace-saver-mode-cockpit-panel.tsx`**

```tsx
import { WorkspaceSaverModePanel } from "../../views/cockpit/workspace-saver-mode-panel.js";
import type { CockpitPanelProps } from "../panel.js";

export function WorkspaceSaverModeCockpitPanel({ dir, id, cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspaceSaverModePanel dir={dir} id={id} cwd={cwd} />;
}
```

- [ ] **Step 5: Register the panel in `panel-registry.ts`**

Add the import:

```ts
import { WorkspaceSaverModeCockpitPanel } from "./panels/workspace-saver-mode-cockpit-panel.js";
```

Insert this descriptor as the FIRST workspace-scoped entry (immediately after the `token-saver` session entry, before `ws-index`):

```ts
  {
    id: "ws-token-saver",
    label: "Saver Mode",
    scope: "workspace",
    component: WorkspaceSaverModeCockpitPanel,
  },
```

- [ ] **Step 6: Update the registry order assertion**

In `apps/gui/test/components/cockpit-panel-registry.test.tsx`, update the expected array to:

```ts
    expect(COCKPIT_PANELS.map((p) => p.id)).toEqual([
      "transcript",
      "telemetry",
      "memory",
      "tasks",
      "token-saver",
      "ws-token-saver",
      "ws-index",
      "ws-context",
      "ws-rules",
      "ws-tools",
      "ws-permissions",
    ]);
```

- [ ] **Step 7: Run the panel + registry tests**

Run: `pnpm --filter @megasaver/gui exec vitest run test/components/workspace-saver-mode-panel.test.tsx test/components/cockpit-panel-registry.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/gui/src/views/cockpit/workspace-saver-mode-panel.tsx apps/gui/src/cockpit/panels/workspace-saver-mode-cockpit-panel.tsx apps/gui/src/cockpit/panel-registry.ts apps/gui/test/components/workspace-saver-mode-panel.test.tsx apps/gui/test/components/cockpit-panel-registry.test.tsx
git commit -m "feat(gui): workspace Saver Mode activation panel"
```

---

## Task 5: Session token-saver panel pointer

**Files:**
- Modify: `apps/gui/src/views/cockpit/token-saver-panel.tsx`

- [ ] **Step 1: Add a one-line pointer under the heading**

In `token-saver-panel.tsx`, immediately after the `<h2>Token saver</h2>` line, add:

```tsx
      <p className="text-xs text-text-muted">
        This tab shows recorded proxy savings. To turn Saver Mode on or off, use the workspace
        “Saver Mode” tab — activation is per-folder, not per-session.
      </p>
```

- [ ] **Step 2: Run the existing token-saver panel tests (if any) + typecheck**

Run: `pnpm --filter @megasaver/gui exec tsc -b --noEmit`
Expected: no errors. (No behavior change; copy-only.)

- [ ] **Step 3: Commit**

```bash
git add apps/gui/src/views/cockpit/token-saver-panel.tsx
git commit -m "docs(gui): point session token-saver panel to workspace Saver Mode"
```

---

## Task 6: Changeset, wiki, full verify, manual smoke

**Files:**
- Create: `.changeset/gui-workspace-saver-mode.md`
- Modify: `wiki/entities/gui.md`, `wiki/entities/connectors-shared.md`, `wiki/log.md`

- [ ] **Step 1: Add the changeset**

Create `.changeset/gui-workspace-saver-mode.md`:

```markdown
---
"@megasaver/gui": minor
"@megasaver/connectors-shared": minor
---

Add workspace-scoped Saver Mode activation to the live GUI. A new "Saver Mode"
workspace tab toggles Mega Saver Mode for a folder by writing the CONTEXT_GATE
block into <cwd>/CLAUDE.md (sentinel-bounded, atomic) and reports MCP-install
status. connectors-shared exposes renderContextGateBlockText +
upsertContextGateBlockText for the render-in-bridge path.
```

- [ ] **Step 2: Update the wiki**

- `wiki/entities/gui.md`: add a line under the GUI entity noting the `ws-token-saver` "Saver Mode" workspace panel and the `/api/claude-sessions/:dir/:id/token-saver/workspace` route (server-derived cwd; writes `<cwd>/CLAUDE.md`).
- `wiki/entities/connectors-shared.md`: note the new `renderContextGateBlockText` + `upsertContextGateBlockText` exports.
- `wiki/log.md`: append a timestamped entry summarising the feature and that activation is per-workspace (cwd), not per-session, with the runtime-chain finding.

- [ ] **Step 3: Run the full verification gate**

Run: `pnpm build && pnpm verify`
Expected: EXIT 0 — `biome check`, `tsc --noEmit`, `vitest run` (all packages), and `conventions:check` all green.

- [ ] **Step 4: Manual smoke (real app)**

```bash
# from apps/gui in this worktree
pnpm dev   # vite + bridge (use a free port if 5173/5174 are taken)
```

In the GUI: select a session, open the workspace **Saver Mode** tab, toggle ON with mode `aggressive`. Then confirm the block was written:

```bash
grep -c "MEGA_SAVER_CG_BLOCK_START" "<that-session-cwd>/CLAUDE.md"
```
Expected: `1`. Toggle OFF, re-run grep, expected: `0` (block removed, surrounding content intact). Verify the panel shows the MCP-install warning when the bridge is not installed for Claude Code.

- [ ] **Step 5: Commit**

```bash
git add .changeset/gui-workspace-saver-mode.md wiki/entities/gui.md wiki/entities/connectors-shared.md wiki/log.md
git commit -m "chore(gui): changeset + wiki for workspace Saver Mode activation"
```

---

## Post-implementation

Per project §4 / risk-modes §12 (HIGH): before merge, request external review with both `code-reviewer` AND `critic` (separate passes; author ≠ reviewer), focusing on the `<cwd>/CLAUDE.md` write path (sentinel containment, atomicity, the disable-no-file guard) and the cwd-derivation traversal guard. Then `superpowers:finishing-a-development-branch`.
```
