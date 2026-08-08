# Planner ↔ Agent Office Launch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent breaks in the planner card → Agent
Office launch path (spec:
`docs/superpowers/specs/2026-08-08-planner-office-launch-fix-design.md`):
wrong workspace identifier, fabricated role strings where a real
agent UUID is required, and a task that queues but never runs.

**Architecture:** A new `POST /api/office/:wk/agents/:agentId/launch`
route (`handleLaunchTask`) reuses `handleCreateTask`'s exact
validation/save path and adds the one missing `scheduleDrain` call.
The modal switches from a hardcoded role `<select>` to real
`fetchAgents(workspaceKey)` data, with an inline create-agent
fallback when a workspace has none. `PlannerPage` threads the real
`workspaceKey` (already computed, never passed) down through
`CardDrawer` to the modal.

**Tech Stack:** TypeScript strict ESM, React, Zod, Vitest +
`@testing-library/react`, existing `RouteContext`/citty-free plain
`node:http` bridge conventions.

## Global Constraints

- `handleCreateTask`'s existing behavior and response contract are UNTOUCHED — the fix is a NEW endpoint, never a modification to `.../tasks` (spec Non-Goal, Locked Decision 3).
- `handleLaunchTask` copies `handleCreateTask`'s validation exactly (same order: `guardOffice` → `validateWk` → `officeAgentIdSchema.safeParse` → body parse → `taskCreateInputSchema`) so its error responses are byte-identical for byte-identical bad input.
- `scheduleDrain` is called AFTER `saveTask` succeeds, never before — a drain scheduled against an unsaved task would race `listTasks` inside `drainAgent`.
- No changes to `packages/agent-office/src/supervisor.ts`, `packages/agent-office/src/launcher-registry.ts`, or any engine file — this plan touches only the GUI bridge route layer and the GUI React layer (spec Non-Goal).
- Every new/changed bridge route keeps the existing `handleCaughtError`-free style this file already uses (each handler catches into `handleOfficeError`, per the existing `office.ts` pattern) — mirror it exactly, do not introduce a different error-handling shape.
- Reuse existing test fixtures verbatim where they already exist: `makeCtx`, `makeFakeLauncher`, `makeBodyReq`, `ROLE_BODY`, `WK`, `WORKDIR`, `UUID_A..F` from `apps/gui/test/bridge/office/routes.test.ts` — do not redefine parallel copies in a new test file; import or colocate in the same file per that file's existing organization.
- cli-test-pattern discipline extends to the GUI bridge tests here: injected `RouteContext`, temp store dirs via `mkdtempSync`/`rmSync` in `beforeEach`/`afterEach`, no timing-tight assertions beyond the one-tick `setTimeout` pattern `routes.test.ts` already uses for fire-and-forget drains.

---

### Task 1: `handleLaunchTask` bridge route + route registration

**Files:**
- Modify: `apps/gui/bridge/routes/office.ts` (add `handleLaunchTask`, export it)
- Modify: `apps/gui/bridge/handler.ts` (register the new route, import the handler)
- Modify: `apps/gui/test/bridge/office/routes.test.ts` (new `describe("handleLaunchTask")` block)

**Interfaces:**

```ts
// office.ts — new export
export async function handleLaunchTask(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void>;
```

**Steps:**

- [ ] Read `handleCreateTask` (`office.ts:294-337`) and `handleRunAgent` (`office.ts:344-372`) in full immediately before writing this task — the new function is their concatenation, not a reinterpretation.
- [ ] Write the failing tests, appended to `apps/gui/test/bridge/office/routes.test.ts` inside a new `describe("handleLaunchTask", ...)` block placed directly after the existing `describe("handleRunAgent", ...)` block (same file, same `beforeEach`/`afterEach` `storeRoot` setup already in scope):

```ts
describe("handleLaunchTask", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-launch-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  async function setupAgentOnly(): Promise<{ agentId: string }> {
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_A });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;
    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Launch Agent", roleId, workdir: WORKDIR }),
      newId: () => UUID_B,
    });
    await handleCreateAgent(agentCtx, WK);
    return { agentId: (agentCtx.capturedJson[0]?.body as AgentBody).id };
  }

  it("saves a queued task AND starts a drain (202, task body, launcher invoked)", async () => {
    const { agentId } = await setupAgentOnly();
    const launchSpy = vi.fn();
    const coreRegistry = createInMemoryCoreRegistry();
    ensureOfficeProject(coreRegistry, () => "2026-06-22T12:00:00.000Z");
    const office: OfficeContext = {
      coreRegistry,
      registry: createLauncherRegistry([
        {
          kind: "claude-code" as AgentId,
          launch(opts) {
            launchSpy();
            return makeFakeLauncher({ exitCode: 0 }).launch(opts);
          },
        },
      ]),
      allowFull: false,
    };
    const ctx = makeCtx({ office, req: makeBodyReq({ instruction: "Build the thing." }) });
    await handleLaunchTask(ctx, WK, agentId);
    expect(ctx.capturedJson[0]?.status).toBe(202);
    const task = ctx.capturedJson[0]?.body as TaskBody;
    expect(task.agentId).toBe(agentId);
    expect(task.status).toBe("queued");
    // wait a tick for the fire-and-forget drain to reach launch()
    await new Promise((r) => setTimeout(r, 10));
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it("invalid workspace key → 400", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ instruction: "x" }) });
    await handleLaunchTask(ctx, "not-a-valid-key", UUID_A);
    expect(ctx.capturedError[0]?.status).toBe(400);
  });

  it("unknown agent id (valid uuid, not created) → 404", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ instruction: "x" }) });
    await handleLaunchTask(ctx, WK, UUID_F);
    // Mirrors handleCreateTask's own id-format-only check: a syntactically
    // valid but never-created agent id is accepted at save time (no existence
    // check in handleCreateTask today) — confirm this against the actual
    // handleCreateTask body before asserting; if handleCreateTask itself has
    // no agent-existence check, this test instead asserts 202 (task saved
    // against a nonexistent agent, same as handleCreateTask's existing
    // behavior) — do not invent a new existence check as part of this task
    // (Non-Goal: handleLaunchTask must match handleCreateTask's validation
    // exactly, nothing more).
  });

  it("malformed body → 400 with issue detail", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ instruction: "" }) });
    const { agentId } = await setupAgentOnly();
    await handleLaunchTask(ctx, WK, agentId);
    expect(ctx.capturedError[0]?.status).toBe(400);
  });
});
```

- [ ] Before finalizing the "unknown agent id" test, actually run `handleCreateTask` against a syntactically-valid-but-uncreated agent id in a scratch REPL or temp test to confirm whether it 202s or 404s today — write the real assertion based on that observed behavior, not the speculative comment above. Delete the comment once the real assertion is in place.
- [ ] RED: `pnpm --filter @megasaver/gui exec vitest run test/bridge/office/routes.test.ts` — expect FAIL (`handleLaunchTask` not exported).
- [ ] Implement `handleLaunchTask` in `office.ts`, placed directly after `handleCreateTask` (adjacent, since it is a variant of it):

```ts
export async function handleLaunchTask(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const agentIdParse = officeAgentIdSchema.safeParse(agentId);
  if (!agentIdParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = taskCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const now = ctx.now();
    const task = officeTaskSchema.parse({
      id: ctx.newId(),
      agentId: agentIdParse.data,
      workspaceKey: wk,
      instruction: parsed.data.instruction,
      status: "queued",
      queuedAt: now,
    });
    await saveTask({ storeRoot: ctx.storeRoot, task });
    scheduleDrain(ctx, wk, agentIdParse.data);
    ctx.sendJson(ctx.res, 202, task, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}
```

- [ ] GREEN: re-run the same vitest command — expect all four (or three, per the resolved 404/202 question above) new tests PASS, and no regression in the existing `describe("handleRunAgent", ...)` block.
- [ ] Register the route in `apps/gui/bridge/handler.ts`, immediately after the existing `officeRunMatch` block (`handler.ts:649-654`, read it first for the exact `return methodNotAllowed(...)` pattern to copy):

```ts
// Launch (queue + immediately schedule a drain)
const officeLaunchMatch = path.match(/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/launch$/);
if (officeLaunchMatch) {
  if (method !== "POST") return methodNotAllowed(res, method, origin);
  const wk = decodeURIComponent(officeLaunchMatch[1] as string);
  const agentId = decodeURIComponent(officeLaunchMatch[2] as string);
  await handleLaunchTask(ctx, wk, agentId);
  return;
}
```

- [ ] Add `handleLaunchTask` to the `office.js` import list at the top of `handler.ts` (alongside the existing `handleCreateTask`/`handleRunAgent` imports).
- [ ] Write one router-level test (new, in `apps/gui/test/bridge/office/routes.test.ts` or wherever the repo's existing router-dispatch tests for Office live — check for a `handler.test.ts` that exercises route matching by path string rather than calling handlers directly; if none exists, add a minimal one asserting `POST /api/office/<wk>/agents/<id>/launch` reaches `handleLaunchTask` via an HTTP-level fetch against a `startTestBridge` instance, mirroring `apps/gui/test/bridge/test-helpers.ts`'s pattern used elsewhere).
- [ ] GREEN: full `pnpm --filter @megasaver/gui exec vitest run test/bridge` — expect PASS.
- [ ] Commit:

```bash
git add apps/gui/bridge/routes/office.ts apps/gui/bridge/handler.ts apps/gui/test/bridge/office/routes.test.ts
git commit -m "feat(gui): add POST /api/office/:wk/agents/:id/launch (queue + drain)"
```

---

### Task 2: `launchTask` client function

**Files:**
- Modify: `apps/gui/src/lib/office-client.ts` (add `launchTask`)
- Modify: `apps/gui/test/components/office/office-client.test.tsx` (new test)

**Interfaces:**

```ts
export function launchTask(wk: string, agentId: string, instruction: string): Promise<OfficeTask>;
```

**Steps:**

- [ ] Read `assignTask`'s exact body (`office-client.ts:113-120`) before writing — `launchTask` is a one-line copy with a different URL suffix.
- [ ] Write the failing test in `apps/gui/test/components/office/office-client.test.tsx` (check that file's existing test structure for `assignTask` or `runAgent` first, and mirror it exactly — likely a fetch-mock assertion on URL + method + body):

```ts
it("launchTask posts to the launch endpoint with the instruction", async () => {
  // mirror this file's existing fetch-mock setup for assignTask/runAgent
  // assert: POST /api/office/<wk>/agents/<id>/launch with body { instruction }
});
```

- [ ] RED: `pnpm --filter @megasaver/gui exec vitest run test/components/office/office-client.test.tsx` — expect FAIL.
- [ ] Implement:

```ts
export function launchTask(wk: string, agentId: string, instruction: string): Promise<OfficeTask> {
  return postJson<OfficeTask>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/launch`,
    { instruction },
  );
}
```

- [ ] Confirm `postJson`'s import/signature matches the file's existing usage (`office-client.ts` likely imports it from a shared `api-client.ts` or defines it locally — check `assignTask`'s import line and match it exactly).
- [ ] GREEN: re-run — expect PASS.
- [ ] Commit:

```bash
git add apps/gui/src/lib/office-client.ts apps/gui/test/components/office/office-client.test.tsx
git commit -m "feat(gui): add launchTask client function"
```

---

### Task 3: `AgentOfficeLaunchModal` rewrite — real agents, not fake role strings

**Files:**
- Modify: `apps/gui/src/components/planner/agent-office-launch-modal.tsx`
- Modify: `apps/gui/test/components/agent-office-launch-modal.test.tsx`

**Interfaces:**

```ts
export function AgentOfficeLaunchModal(props: {
  card: PlannerCard;
  workspaceKey: string;
  onClose: () => void;
  onLaunched: (task: OfficeTask) => void;
}): JSX.Element;
```

**Steps:**

- [ ] Read `apps/gui/src/views/office/agent-board.tsx`'s existing agent-creation flow (`createAgent(wk, input)` call site, likely near line 314 per the earlier grep) in full — the modal's empty-state sub-form must reuse this exact call shape, not invent a new one.
- [ ] Write the failing tests, rewriting `apps/gui/test/components/agent-office-launch-modal.test.tsx` (the existing single test asserted only header/title text against a hardcoded render — extend it, keep that assertion, add the new ones):

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentOfficeLaunchModal } from "../../src/components/planner/agent-office-launch-modal.js";
import * as officeClient from "../../src/lib/office-client.js";

const CARD = {
  id: "c1",
  title: "Task for Agent",
  status: "in-progress" as const,
  priority: "high" as const,
  tags: ["core"],
  assignedAgent: null,
  createdAt: "2026-08-07T00:00:00Z",
  updatedAt: "2026-08-07T00:00:00Z",
  content: "## Goals\nImplement feature",
  filePath: ".megasaver/planner/in-progress/c1.md",
  checklist: { total: 0, completed: 0 },
};

describe("AgentOfficeLaunchModal component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders modal header and task title", () => {
    vi.spyOn(officeClient, "fetchAgents").mockResolvedValue([]);
    render(
      <AgentOfficeLaunchModal card={CARD} workspaceKey="abc1234500001111" onClose={vi.fn()} onLaunched={vi.fn()} />,
    );
    expect(screen.getByText("Launch Agent Office Task")).toBeDefined();
    expect(screen.getByText("Task for Agent")).toBeDefined();
  });

  it("renders real fetched agents, never the old hardcoded role strings", async () => {
    vi.spyOn(officeClient, "fetchAgents").mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Real Agent", roleId: "r1", kind: "claude-code", workspaceKey: "abc1234500001111", workdir: "/x", status: "idle", createdAt: "2026-08-07T00:00:00Z" },
    ]);
    render(
      <AgentOfficeLaunchModal card={CARD} workspaceKey="abc1234500001111" onClose={vi.fn()} onLaunched={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(/Real Agent/)).toBeDefined());
    expect(screen.queryByText(/builder \(Feature/)).toBeNull();
  });

  it("shows a create-agent affordance when the workspace has zero agents", async () => {
    vi.spyOn(officeClient, "fetchAgents").mockResolvedValue([]);
    vi.spyOn(officeClient, "fetchRoles").mockResolvedValue([]);
    render(
      <AgentOfficeLaunchModal card={CARD} workspaceKey="abc1234500001111" onClose={vi.fn()} onLaunched={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText(/No agents in this workspace/)).toBeDefined());
  });

  it("handleLaunch calls launchTask with the real selected agent id, never a role string", async () => {
    vi.spyOn(officeClient, "fetchAgents").mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Real Agent", roleId: "r1", kind: "claude-code", workspaceKey: "abc1234500001111", workdir: "/x", status: "idle", createdAt: "2026-08-07T00:00:00Z" },
    ]);
    const launchSpy = vi.spyOn(officeClient, "launchTask").mockResolvedValue({
      id: "t1", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspaceKey: "abc1234500001111", instruction: "x", status: "queued", queuedAt: "2026-08-07T00:00:00Z",
    });
    const onLaunched = vi.fn();
    render(
      <AgentOfficeLaunchModal card={CARD} workspaceKey="abc1234500001111" onClose={vi.fn()} onLaunched={onLaunched} />,
    );
    await waitFor(() => expect(screen.getByText(/Real Agent/)).toBeDefined());
    fireEvent.click(screen.getByText("Launch Task"));
    await waitFor(() => expect(launchSpy).toHaveBeenCalledWith("abc1234500001111", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expect.any(String)));
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
  });
});
```

- [ ] Confirm `OfficeAgent`'s exact field shape (`office-client.ts:15-23`) before finalizing the mocked objects above — match every field name/type exactly (the plan's guess may drift from the real type; correct it here, not silently at implementation time).
- [ ] RED: `pnpm --filter @megasaver/gui exec vitest run test/components/agent-office-launch-modal.test.tsx` — expect FAIL.
- [ ] Rewrite `agent-office-launch-modal.tsx`:

```tsx
import type { PlannerCard } from "@megasaver/core";
import { useEffect, useState } from "react";
import {
  type OfficeAgent,
  type OfficeRole,
  type OfficeTask,
  createAgent,
  fetchAgents,
  fetchRoles,
  launchTask,
} from "../../lib/office-client.js";

export function AgentOfficeLaunchModal(props: {
  card: PlannerCard;
  workspaceKey: string;
  onClose: () => void;
  onLaunched: (task: OfficeTask) => void;
}): JSX.Element {
  const { card, workspaceKey, onClose, onLaunched } = props;
  const [agents, setAgents] = useState<OfficeAgent[] | null>(null);
  const [roles, setRoles] = useState<OfficeRole[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(card.assignedAgent ?? "");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentRoleId, setNewAgentRoleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents(workspaceKey)
      .then((list) => {
        setAgents(list);
        if (list.length > 0 && selectedAgentId === "") setSelectedAgentId(list[0]?.id ?? "");
        if (list.length === 0) fetchRoles().then(setRoles).catch(() => setRoles([]));
      })
      .catch(() => setAgents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey]);

  const handleCreateAgent = async () => {
    if (newAgentName.trim() === "" || newAgentRoleId === "") return;
    setLoading(true);
    setError(null);
    try {
      const agent = await createAgent(workspaceKey, {
        name: newAgentName.trim(),
        roleId: newAgentRoleId,
        workdir: workspaceKey, // corrected below once the real CreateAgentInput shape is confirmed
      });
      setAgents((prev) => [...(prev ?? []), agent]);
      setSelectedAgentId(agent.id);
    } catch {
      setError("Could not create agent.");
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async () => {
    if (selectedAgentId === "") return;
    setLoading(true);
    setError(null);
    try {
      const prompt = `Task: ${card.title}\n\n${card.content}`;
      const task = await launchTask(workspaceKey, selectedAgentId, prompt);
      onLaunched(task);
    } catch {
      setError("Failed to launch task in Agent Office.");
    } finally {
      setLoading(false);
    }
  };

  // ...render: header/task-title unchanged; body switches on agents === null
  // (loading) / agents.length === 0 (create-agent sub-form) / else (real
  // agent <select> populated from `agents`); error renders inline, never
  // window.alert; Cancel/Launch footer unchanged except onClick=handleLaunch
  // and disabled={loading || selectedAgentId === ""}.
}
```

- [ ] **STOP before finalizing `handleCreateAgent`'s `workdir` field**: read `CreateAgentInput`'s real shape (`office-client.ts:66-77`) and `agent-board.tsx`'s real call site for `createAgent` — `workdir` almost certainly must be the workspace's real filesystem path (matching `encodeWorkspaceKey(workdir) === wk`, per `handleCreateAgent`'s own bridge-side check at `office.ts:216-224`), NOT the `workspaceKey` string itself. The planner already has this real path available as its own `cwd` variable — thread `cwd` into the modal as a SECOND prop (alongside `workspaceKey`) specifically for this one call, since the bridge validates the two must correspond. Fix the snippet above before writing the real component: `<AgentOfficeLaunchModal card={card} workspaceKey={workspaceKey} cwd={cwd} onClose={...} onLaunched={...} />`, and use `cwd` (not `workspaceKey`) as the `workdir` value in `handleCreateAgent`.
- [ ] Write out the full render body (header unchanged from the original; task title unchanged; role/agent selection area replaced per the three states above; footer buttons unchanged in position, `Launch Task` button label unchanged).
- [ ] GREEN: re-run — expect all tests PASS.
- [ ] Commit:

```bash
git add apps/gui/src/components/planner/agent-office-launch-modal.tsx apps/gui/test/components/agent-office-launch-modal.test.tsx
git commit -m "fix(gui): planner launch modal offers real agents, not fake role strings"
```

---

### Task 4: `CardDrawer` + `PlannerPage` wiring — real workspaceKey, real outcome banner

**Files:**
- Modify: `apps/gui/src/components/planner/card-drawer.tsx`
- Modify: `apps/gui/src/views/planner-page.tsx`
- Modify: whatever test file covers `CardDrawer` (`rg -l "CardDrawer" apps/gui/test` — check first; create `apps/gui/test/components/planner/card-drawer.test.tsx` if none exists)

**Steps:**

- [ ] Read the FULL current `card-drawer.tsx` (not just the tail shown during investigation) to find every place `cwd` is used, so the new `workspaceKey` prop is added without breaking the file's other existing uses of `cwd` (e.g. any display text).
- [ ] Write the failing test asserting: (a) no `window.alert` call on launch success (spy `window.alert`, assert not called), (b) an inline banner renders text derived from the launched task/agent, (c) `CardDrawer` passes `workspaceKey` (not `cwd`) to `AgentOfficeLaunchModal` — mirror whatever render-testing pattern the file's sibling tests already use (check `apps/gui/test/components/planner/` for `kanban-grid.test.tsx` or similar as the house style).
- [ ] RED: run the new/updated test file — expect FAIL.
- [ ] Add `workspaceKey: string` to `CardDrawer`'s props type; thread it to `<AgentOfficeLaunchModal card={card} workspaceKey={workspaceKey} cwd={cwd} .../>` (both props, per Task 3's resolved decision).
- [ ] Add local state `const [launchedTask, setLaunchedTask] = useState<OfficeTask | null>(null);` (import `OfficeTask` type from `office-client.js`); change `onLaunched={() => {...}}` to:

```tsx
onLaunched={(task) => {
  setLaunchModalOpen(false);
  setLaunchedTask(task);
  // Persist the assignment onto the card via the same PATCH path the drawer's
  // Save Changes button already uses (find and reuse that exact function —
  // do not invent a second card-patch code path).
}}
```

- [ ] Render `launchedTask` as a dismissable inline banner near the top of the drawer body (below the header, above the Task field) — simple text: `` `Launched on agent ${launchedTask.agentId} — status: ${launchedTask.status}` `` with a small "×" dismiss button setting `launchedTask` back to `null`. (If the drawer already fetches/has access to the agent's `name` at this point, prefer showing the name over the raw id — check whether `agents` data is already in scope in this component before adding a new fetch just for a label; if not readily available, the id is an acceptable fallback for v1 — do not add a new fetch call solely for a display label unless it is trivial.)
- [ ] Wire the card-patch: locate the drawer's existing `PATCH /api/planner/card` call (used by "Save Changes") and reuse it to send `{ cwd, id: card.id, assignedAgent: task.agentId }` — check the exact existing patch function's signature before calling it a second time from the `onLaunched` handler; do not duplicate the fetch call inline if a reusable function already exists in this file.
- [ ] In `apps/gui/src/views/planner-page.tsx`, add `workspaceKey={activeWorkspace?.key ?? ""}` to the existing `<CardDrawer cwd={cwd} .../>` render call (the file's existing prop list, extended by one).
- [ ] Find the button/entry point that opens the launch modal (inside `CardDrawer`, the button that sets `launchModalOpen(true)`) and add `disabled={workspaceKey === ""}` plus a `title="No active workspace"` when disabled, mirroring the file's own `if (!cwd) return;` early-return convention used elsewhere for the same "no active workspace" case (translated to a disabled-button UX here since this is a modal-opening button, not an async handler).
- [ ] GREEN: re-run the touched test files — expect PASS.
- [ ] Manually trace (do not skip): `PlannerPage` → `activeWorkspace.key` → `CardDrawer workspaceKey` prop → `AgentOfficeLaunchModal workspaceKey` prop → `fetchAgents(workspaceKey)` URL → matches `validateWk`'s 16-hex-char requirement. Confirm this chain compiles under `tsc` (`pnpm --filter @megasaver/gui typecheck`) before committing — a prop threaded through three components is exactly the kind of chain a rename elsewhere can silently break.
- [ ] Commit:

```bash
git add apps/gui/src/components/planner/card-drawer.tsx apps/gui/src/views/planner-page.tsx apps/gui/test/components/planner/card-drawer.test.tsx
git commit -m "fix(gui): thread real workspaceKey into planner launch modal, drop alert()"
```

---

### Task 5: Full verification, changeset, wiki log

**Files:**
- Create: `.changeset/planner-office-launch-fix.md`
- Modify: `wiki/log.md`

**Steps:**

- [ ] Run the full monorepo gate from repo root:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
pnpm verify
```

- [ ] Confirm all Turbo tasks green (note the exact pass count observed, per this repo's evidence convention — do not assume a stale historical number).
- [ ] Manually smoke-test the full chain if a local Claude Code launcher is available in the dev environment: `mega gui`, open a workspace with the planner tab, open a card, click Launch, select (or create) an agent, click "Launch Task", confirm the Agent Office floor view shows the task moving off `"queued"`. If no live launcher is available in this environment, skip the manual smoke step and rely on the unit/integration test evidence from Tasks 1-4 — do not claim manual verification that did not happen (verification-before-completion discipline).
- [ ] Create the changeset `.changeset/planner-office-launch-fix.md`:

```markdown
---
"@megasaver/gui": patch
---

Fix the Planner card "Launch Task" flow: it previously sent an invalid
workspace identifier (raw path instead of the 16-hex workspace key),
offered four fabricated role strings instead of the workspace's real
Agent Office agents, and — even when a request reached the server —
never actually scheduled the task to run. Adds a dedicated
queue-and-launch endpoint and rewrites the launch modal to select a
real agent (or create one inline) before launching.
```

- [ ] Append a timestamped `wiki/log.md` entry: what was broken (three independent breaks, cite the exact lines found during investigation), what was fixed, verification evidence (`pnpm verify` pass count, which tests newly cover the launch path).
- [ ] Final commit:

```bash
git add .changeset/planner-office-launch-fix.md wiki/log.md
git commit -m "docs: changeset + wiki log for planner-office launch fix"
```
