# Agent Setup Functional Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GUI `Agent Setup` view install/repair the Mega Saver connector block into a real project and report an accurate status.

**Architecture:** Add a read-only `GET /api/projects` bridge route so the doctor can list projects; make the doctor project-aware; fix `createMcpOps` status resolution; guard the doctor's load effect against stale responses.

**Tech stack:** React 18, TypeScript strict ESM, Vitest, Testing Library, Node HTTP bridge, `@megasaver/core` registry.

---

### Task 1: Add `GET /api/projects` bridge route

**Files:**
- Create: `apps/gui/bridge/routes/projects.ts`
- Modify: `apps/gui/bridge/handler.ts`
- Modify: `apps/gui/bridge/route-context.ts`
- Test: `apps/gui/test/bridge/projects-route.test.ts`

- [ ] **Step 1: Write the route handler**

```ts
import type { RouteContext } from "../route-context.js";

export async function handleListProjects(ctx: RouteContext): Promise<void> {
  const projects = ctx.registry?.listProjects().map((p) => ({ id: p.id, name: p.name, rootPath: p.rootPath })) ?? [];
  ctx.sendJson(ctx.res, 200, projects, ctx.origin);
}
```

- [ ] **Step 2: Wire it into `handler.ts` before the `/api/mcp/` block**

```ts
if (path === "/api/projects") {
  if (method !== "GET") return methodNotAllowed(res, method, origin);
  await handleListProjects(ctx);
  return;
}
```

- [ ] **Step 3: Add optional `registry` to `BridgeHandlerOptions` and `RouteContext`, and pass it from `server.ts`**

`server.ts` already has `registry`; pass it as `registry` to `createBridgeHandler`. Make it optional so `handler-no-registry.test.ts` still passes.

- [ ] **Step 4: Write the test**

Create `apps/gui/test/bridge/projects-route.test.ts` that starts a server with an in-memory registry containing one project and asserts `GET /api/projects` returns `[{ id, name, rootPath }]`.

- [ ] **Step 5: Run the bridge tests**

```bash
pnpm --filter @megasaver/gui exec vitest run test/bridge/projects-route.test.ts test/bridge/handler-no-registry.test.ts test/bridge/mcp-setup.test.ts
```

Expected: PASS.

---

### Task 2: Fix `createMcpOps` connector resolution

**Files:**
- Modify: `apps/gui/bridge/mcp-ops.ts`
- Test: `apps/gui/test/bridge/mcp-ops.test.ts`

- [ ] **Step 1: Change `connectorSyncedResolver` to scan all projects for the block**

```ts
connectorSyncedResolver: async (agentId) => {
  const target = targetFor(agentId);
  if (target === null) return false;
  for (const project of deps.registry.listProjects()) {
    const existing = await readTargetFile(join(project.rootPath, target.relativePath));
    if (existing !== null && parseBlock(existing).block !== null) return true;
  }
  return false;
},
```

- [ ] **Step 2: Add regression tests**

In `mcp-ops.test.ts`:
- After `repair("claude-code", "demo")`, status returns `connectorSynced: true` even with **no** open sessions.
- After `install("claude-code", "demo")` without repair, status returns `connectorSynced: false` (block not written).

- [ ] **Step 3: Run the tests**

```bash
pnpm --filter @megasaver/gui exec vitest run test/bridge/mcp-ops.test.ts
```

Expected: PASS.

---

### Task 3: Add `fetchProjects` to the GUI API client

**Files:**
- Modify: `apps/gui/src/lib/api-client.ts`

- [ ] **Step 1: Add the type and function**

```ts
export type Project = { id: string; name: string; rootPath: string };
export function fetchProjects(): Promise<Project[]> {
  return getJson<Project[]>("/api/projects");
}
```

No tests needed here (thin wrapper); coverage comes from doctor tests.

---

### Task 4: Make `AgentSetupDoctor` project-aware

**Files:**
- Modify: `apps/gui/src/views/agent-setup-doctor.tsx`
- Modify: `apps/gui/src/lib/api-client.ts` (already done in Task 3)
- Test: `apps/gui/test/views/agent-setup-doctor.test.tsx`

- [ ] **Step 1: Load projects and selected project state**

```ts
const [projects, setProjects] = useState<Project[]>([]);
const [selectedProject, setSelectedProject] = useState<string>("");
```

In the initial load effect (guarded per Task 5), also call `fetchProjects()` and auto-select the only project:

```ts
if (list.length === 1) setSelectedProject(list[0].name);
```

- [ ] **Step 2: Render project selection UI**

- Empty project list: show a notice (e.g., "Create a project first to set up an agent.") and disable actions.
- Single project: show read-only label with the project name.
- Multiple projects: render a `<select>` bound to `selectedProject`.

- [ ] **Step 3: Pass the selected project to install/repair**

```ts
if (action === "install") await installMcp(agentId, selectedProject);
else if (action === "repair") await repairMcp(agentId, selectedProject);
```

Remove the old `MCP_PROJECT_PLACEHOLDER = "."` usage from `api-client.ts` for these two functions.

- [ ] **Step 4: Update the doctor tests**

Mock `fetch` for both `/api/mcp/status` and `/api/projects`. Existing assertions about `project: "."` change to the mocked project name. Add a test for the empty-project notice and disabled actions. Add a test for multiple projects rendering a `<select>`.

- [ ] **Step 5: Run doctor tests**

```bash
pnpm --filter @megasaver/gui exec vitest run test/views/agent-setup-doctor.test.tsx
```

Expected: PASS.

---

### Task 5: Guard `AgentSetupDoctor` load effect

**Files:**
- Modify: `apps/gui/src/views/agent-setup-doctor.tsx`
- Test: `apps/gui/test/views/agent-setup-doctor.test.tsx`

- [ ] **Step 1: Replace the unguarded `useEffect` with a guarded one**

```ts
useEffect(() => {
  let live = true;
  let requestId = 0;
  const run = async (): Promise<void> => {
    const id = ++requestId;
    setLoadState("loading");
    setError(null);
    try {
      const [status, list] = await Promise.all([fetchMcpStatus(), fetchProjects()]);
      if (!live || id !== requestId) return;
      setAgents(status.agents);
      setProjects(list);
      if (list.length === 1) setSelectedProject(list[0].name);
      setLoadState("ready");
    } catch (err) {
      if (!live || id !== requestId) return;
      setError(err as BridgeError);
      setLoadState("error");
    }
  };
  void run();
  return () => { live = false; };
}, []);
```

- [ ] **Step 2: Add a regression test for stale responses**

Use a deferred first `fetchMcpStatus` and a fast second status/projects call triggered by a retry; assert the final state uses the second response, not the first.

- [ ] **Step 3: Run doctor tests again**

```bash
pnpm --filter @megasaver/gui exec vitest run test/views/agent-setup-doctor.test.tsx
```

Expected: PASS.

---

### Task 6: Verify full scope

- [ ] **Step 1: Run GUI tests**

```bash
pnpm --filter @megasaver/gui test
```

Expected: all pass.

- [ ] **Step 2: Run GUI typecheck**

```bash
pnpm --filter @megasaver/gui typecheck
```

Expected: no errors.

- [ ] **Step 3: Run Biome on the changed scope**

```bash
pnpm exec biome check apps/gui/src apps/gui/test apps/gui/bridge
```

Expected: clean.

- [ ] **Step 4: Run CLI e2e regression**

```bash
cd apps/cli && pnpm exec vitest run test/e2e/v1-closeout-flow.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Runtime smoke**

Start `pnpm dev:bridge` (with a temp store), `curl /api/projects`, and confirm it returns the expected shape. If a Vite dev server is already running, open Agent Setup, pick a project, and verify Set up / Repair flips the status to Ready.

---

### Task 7: Update wiki log

- [ ] Append a dated entry to `wiki/log.md` summarizing the fix.
