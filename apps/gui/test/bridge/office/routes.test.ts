import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentOfficeError,
  createLauncherRegistry,
  createSupervisor,
  listAgents,
  listAudit,
  saveAgent,
} from "@megasaver/agent-office";
import type { AgentLauncher, LaunchHandle } from "@megasaver/connectors-shared";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { type AgentId, encodeWorkspaceKey } from "@megasaver/shared";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeContext, RouteContext } from "../../../bridge/route-context.js";
import {
  OFFICE_PROJECT_ID,
  ensureOfficeProject,
  handleControlAgent,
  handleCreateAgent,
  handleCreateRole,
  handleCreateTask,
  handleDeleteAgent,
  handleDeleteRole,
  handleListAgents,
  handleListAudit,
  handleListRoles,
  handleListTasks,
  handleOfficeStatus,
  handleOfficeStream,
  handleRunAgent,
  mapOfficeError,
} from "../../../bridge/routes/office.js";

// ---------------------------------------------------------------------------
// Typed body shapes for assertions (avoids Record<string,unknown> conflicts)
// ---------------------------------------------------------------------------

type RoleBody = { id: string; name: string };
type AgentBody = { id: string; status: string; kind: string; workspaceKey: string };
type TaskBody = { id: string; status: string; agentId: string };
type StatusBody = { agents: unknown[] };

// ---------------------------------------------------------------------------
// Fake launcher (no real 'claude' subprocess)
// ---------------------------------------------------------------------------

function makeFakeLauncher(opts?: { exitCode?: number }): AgentLauncher {
  const exitCode = opts?.exitCode ?? 0;
  return {
    kind: "claude-code" as AgentId,
    launch(): LaunchHandle {
      return {
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        onEvent: () => {},
        onExit(cb) {
          Promise.resolve().then(() => cb({ code: exitCode }));
        },
        cancel: vi.fn(),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Valid RFC 4122 v4 UUIDs for tests
// ---------------------------------------------------------------------------
// Format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UUID_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UUID_F = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// ---------------------------------------------------------------------------
// Test context factory
// ---------------------------------------------------------------------------

let storeRoot: string;

function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext & {
  capturedJson: { status: number; body: unknown }[];
  capturedError: { status: number; code: string; message: string }[];
} {
  const capturedJson: { status: number; body: unknown }[] = [];
  const capturedError: { status: number; code: string; message: string }[] = [];

  const fakeRes = {
    write: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
    headersSent: false,
  } as unknown as ServerResponse;

  const fakeReq = {
    on: vi.fn(),
  } as unknown as IncomingMessage;

  const ctx: RouteContext = {
    req: fakeReq,
    res: fakeRes,
    mcpOps: {} as RouteContext["mcpOps"],
    origin: "http://localhost:5173",
    query: new URLSearchParams(),
    storeRoot,
    claudeProjectsDir: "/tmp/projects",
    claudeSessionsMetaDir: "/tmp/meta",
    claudeSettingsPath: "/tmp/settings.json",
    resolveWorkspace: (cwd: string) => ({
      workspaceKey: WK as import("@megasaver/shared").WorkspaceKey,
      label: cwd,
      cwd,
    }),
    newId: () => UUID_A,
    now: () => "2026-06-22T12:00:00.000Z",
    sendJson: (res, status, body) => {
      capturedJson.push({ status, body });
    },
    sendError: (res, status, code, message) => {
      capturedError.push({ status, code, message });
    },
    sendText: vi.fn(),
    office: {
      coreRegistry: createInMemoryCoreRegistry(),
      registry: createLauncherRegistry([makeFakeLauncher()]),
      allowFull: false,
    },
    ...overrides,
  };

  return Object.assign(ctx, { capturedJson, capturedError });
}

function makeBodyReq(body: unknown): IncomingMessage {
  const json = JSON.stringify(body);
  const chunks = [Buffer.from(json)];
  type ListenerMap = {
    data: ((...args: unknown[]) => void)[];
    end: ((...args: unknown[]) => void)[];
  };
  const listeners: Partial<ListenerMap> = {};
  const req = {
    on(event: string, cb: (...args: unknown[]) => void) {
      const key = event as keyof ListenerMap;
      if (!listeners[key]) listeners[key] = [];
      // biome-ignore lint/style/noNonNullAssertion: just initialized above
      listeners[key]!.push(cb);
      if (event === "end") {
        // Trigger data + end after current microtask
        Promise.resolve().then(() => {
          const dataListeners = listeners.data ?? [];
          const endListeners = listeners.end ?? [];
          for (const chunk of chunks) {
            for (const fn of dataListeners) fn(chunk);
          }
          for (const fn of endListeners) fn();
        });
      }
      return req;
    },
  } as unknown as IncomingMessage;
  return req;
}

// ---------------------------------------------------------------------------
// Workspace key used in tests — derived from a fixed project dir so the bridge's
// `encodeWorkspaceKey(workdir) === wk` guard holds for agent-create bodies.
// ---------------------------------------------------------------------------
const WORKDIR = "/tmp/office-workdir";
const WK = encodeWorkspaceKey(WORKDIR);

// ---------------------------------------------------------------------------
// Shared role fixture
// ---------------------------------------------------------------------------
const ROLE_BODY = {
  name: "Dev Agent",
  kind: "claude-code",
  persona: "You are a dev agent.",
  model: "sonnet",
  allowedTools: ["Bash", "Read"],
  skillPacks: [],
  permissionMode: "plan",
} as const;

// ---------------------------------------------------------------------------
// Role CRUD
// ---------------------------------------------------------------------------

describe("handleListRoles / handleCreateRole / handleDeleteRole", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("list returns empty array when no roles", async () => {
    const ctx = makeCtx();
    await handleListRoles(ctx);
    expect(ctx.capturedJson[0]).toMatchObject({ status: 200, body: [] });
  });

  it("create role → 201 with server-generated id", async () => {
    const ctx = makeCtx({ req: makeBodyReq(ROLE_BODY) });
    await handleCreateRole(ctx);
    expect(ctx.capturedJson[0]?.status).toBe(201);
    const role = ctx.capturedJson[0]?.body as RoleBody;
    expect(role.name).toBe("Dev Agent");
    expect(role.id).toBe(UUID_A);
  });

  it("create role rejects body with extra field (strict)", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ ...ROLE_BODY, id: "injected" }) });
    await handleCreateRole(ctx);
    expect(ctx.capturedError[0]?.status).toBe(400);
    expect(ctx.capturedError[0]?.code).toBe("validation_failed");
  });

  it("create role rejects allowedTools with leading dash (security)", async () => {
    const ctx = makeCtx({
      req: makeBodyReq({ ...ROLE_BODY, allowedTools: ["--evil-flag"] }),
    });
    await handleCreateRole(ctx);
    expect(ctx.capturedError[0]?.status).toBe(400);
    expect(ctx.capturedError[0]?.code).toBe("validation_failed");
  });

  it("delete role → 204 no content", async () => {
    // First create the role
    const createCtx = makeCtx({ req: makeBodyReq(ROLE_BODY) });
    await handleCreateRole(createCtx);
    const roleId = (createCtx.capturedJson[0]?.body as RoleBody).id;

    const delCtx = makeCtx();
    await handleDeleteRole(delCtx, roleId);
    expect(delCtx.capturedJson).toHaveLength(0);
    expect(delCtx.res.writeHead as Mock).toHaveBeenCalledWith(204, expect.anything());
    expect(delCtx.res.end as Mock).toHaveBeenCalled();
  });

  it("delete role with bad id → 404", async () => {
    const ctx = makeCtx();
    await handleDeleteRole(ctx, "not-a-uuid");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });

  it("sendError 500 when office not configured", async () => {
    // Double cast needed: exactOptionalPropertyTypes forbids explicit undefined in Partial<RouteContext>
    const ctx = makeCtx({ office: undefined } as unknown as Partial<RouteContext>);
    await handleListRoles(ctx);
    expect(ctx.capturedError[0]?.status).toBe(500);
    expect(ctx.capturedError[0]?.code).toBe("office_not_configured");
  });
});

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

describe("handleListAgents / handleCreateAgent / handleDeleteAgent", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("list agents returns empty array", async () => {
    const ctx = makeCtx();
    await handleListAgents(ctx, WK);
    expect(ctx.capturedJson[0]).toMatchObject({ status: 200, body: [] });
  });

  it("create agent → 201 with idle status + role-derived kind", async () => {
    // Create role first (uses UUID_A for id)
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_A });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;
    expect(roleId).toBe(UUID_A);

    // Create agent (uses UUID_B for id)
    const agentBody = { name: "My Agent", roleId, workdir: WORKDIR };
    const agentCtx = makeCtx({ req: makeBodyReq(agentBody), newId: () => UUID_B });
    await handleCreateAgent(agentCtx, WK);
    expect(agentCtx.capturedJson[0]?.status).toBe(201);
    const agent = agentCtx.capturedJson[0]?.body as AgentBody;
    expect(agent.status).toBe("idle");
    expect(agent.kind).toBe("claude-code");
    expect(agent.workspaceKey).toBe(WK);
    expect(agent.id).toBe(UUID_B);
  });

  it("create agent with invalid body → 400", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ name: "X", workdir: "/tmp" }) });
    await handleCreateAgent(ctx, WK);
    expect(ctx.capturedError[0]?.status).toBe(400);
  });

  it("create agent rejects a workdir that does not match the workspace → 400", async () => {
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_A });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Mismatch", roleId, workdir: "/somewhere/else" }),
      newId: () => UUID_B,
    });
    await handleCreateAgent(agentCtx, WK);
    expect(agentCtx.capturedError[0]?.status).toBe(400);
    expect(agentCtx.capturedError[0]?.code).toBe("validation_failed");
  });

  it("delete agent → 204 no content", async () => {
    // Create role
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_C });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;

    // Create agent
    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Del Agent", roleId, workdir: WORKDIR }),
      newId: () => UUID_D,
    });
    await handleCreateAgent(agentCtx, WK);
    const agentId = (agentCtx.capturedJson[0]?.body as AgentBody).id;
    expect(agentId).toBe(UUID_D);

    // Delete
    const delCtx = makeCtx();
    await handleDeleteAgent(delCtx, WK, agentId);
    expect(delCtx.capturedJson).toHaveLength(0);
    expect(delCtx.res.writeHead as Mock).toHaveBeenCalledWith(204, expect.anything());
    expect(delCtx.res.end as Mock).toHaveBeenCalled();
  });

  it("delete agent with non-uuid → 404", async () => {
    const ctx = makeCtx();
    await handleDeleteAgent(ctx, WK, "bad-id");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

describe("handleListTasks / handleCreateTask", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  // Use a valid v4 UUID for the agent id
  const AGENT_ID = UUID_E;

  it("list tasks returns empty array", async () => {
    const ctx = makeCtx();
    await handleListTasks(ctx, WK, AGENT_ID);
    expect(ctx.capturedJson[0]).toMatchObject({ status: 200, body: [] });
  });

  it("create task → 201 queued", async () => {
    const ctx = makeCtx({
      req: makeBodyReq({ instruction: "Write some code." }),
      newId: () => UUID_F,
    });
    await handleCreateTask(ctx, WK, AGENT_ID);
    expect(ctx.capturedJson[0]?.status).toBe(201);
    const task = ctx.capturedJson[0]?.body as TaskBody;
    expect(task.status).toBe("queued");
    expect(task.agentId).toBe(AGENT_ID);
    expect(task.id).toBe(UUID_F);
  });

  it("create task with empty instruction → 400", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ instruction: "" }) });
    await handleCreateTask(ctx, WK, AGENT_ID);
    expect(ctx.capturedError[0]?.status).toBe(400);
  });

  it("create task with bad agent id → 404", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ instruction: "x" }) });
    await handleCreateTask(ctx, WK, "bad-id");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Control transitions
// ---------------------------------------------------------------------------

describe("handleControlAgent", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  /** Creates a role + agent in the store; returns agentId */
  async function createAgentInStore(): Promise<string> {
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_A });
    await handleCreateRole(roleCtx);
    expect(roleCtx.capturedJson[0]?.status).toBe(201);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Ctrl Agent", roleId, workdir: WORKDIR }),
      newId: () => UUID_B,
    });
    await handleCreateAgent(agentCtx, WK);
    expect(agentCtx.capturedJson[0]?.status).toBe(201);
    return (agentCtx.capturedJson[0]?.body as AgentBody).id;
  }

  it("pause → status paused", async () => {
    const agentId = await createAgentInStore();
    const ctx = makeCtx({ req: makeBodyReq({ action: "pause" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect(ctx.capturedJson[0]?.status).toBe(200);
    expect((ctx.capturedJson[0]?.body as AgentBody).status).toBe("paused");
  });

  it("resume → status idle", async () => {
    const agentId = await createAgentInStore();
    const pauseCtx = makeCtx({ req: makeBodyReq({ action: "pause" }) });
    await handleControlAgent(pauseCtx, WK, agentId);

    const ctx = makeCtx({ req: makeBodyReq({ action: "resume" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect((ctx.capturedJson[0]?.body as AgentBody).status).toBe("idle");
  });

  it("stop → status stopped", async () => {
    const agentId = await createAgentInStore();
    const ctx = makeCtx({ req: makeBodyReq({ action: "stop" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect((ctx.capturedJson[0]?.body as AgentBody).status).toBe("stopped");
  });

  it("invalid action → 400", async () => {
    const agentId = await createAgentInStore();
    const ctx = makeCtx({ req: makeBodyReq({ action: "explode" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect(ctx.capturedError[0]?.status).toBe(400);
  });

  it("non-uuid agent id → 404", async () => {
    const ctx = makeCtx({ req: makeBodyReq({ action: "pause" }) });
    await handleControlAgent(ctx, WK, "not-a-uuid");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Run agent (fire-and-forget)
// ---------------------------------------------------------------------------

describe("handleRunAgent", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  /** Creates role + agent + task; returns { agentId, taskId } */
  async function setupAgentWithTask(): Promise<{ agentId: string; taskId: string }> {
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_A });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Run Agent", roleId, workdir: WORKDIR }),
      newId: () => UUID_B,
    });
    await handleCreateAgent(agentCtx, WK);
    const agentId = (agentCtx.capturedJson[0]?.body as AgentBody).id;

    const taskCtx = makeCtx({
      req: makeBodyReq({ instruction: "Do something." }),
      newId: () => UUID_C,
    });
    await handleCreateTask(taskCtx, WK, agentId);
    const taskId = (taskCtx.capturedJson[0]?.body as TaskBody).id;

    return { agentId, taskId };
  }

  it("returns 202 with agent snapshot immediately (fire-and-forget)", async () => {
    const { agentId } = await setupAgentWithTask();
    const ctx = makeCtx();
    await handleRunAgent(ctx, WK, agentId);
    expect(ctx.capturedJson[0]?.status).toBe(202);
    const agent = ctx.capturedJson[0]?.body as AgentBody;
    expect(agent.id).toBe(agentId);
  });

  it("non-uuid agent id → 404", async () => {
    const ctx = makeCtx();
    await handleRunAgent(ctx, WK, "bad-id");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });

  it("does not start a second drain when the agent is already working (concurrent-run guard)", async () => {
    const { agentId } = await setupAgentWithTask();
    // Force the agent into `working` directly in the store.
    const agents = await listAgents({ storeRoot, workspaceKey: WK });
    const existing = agents[0];
    if (existing === undefined) throw new Error("expected an agent in the store");
    await saveAgent({ storeRoot, agent: { ...existing, status: "working" } });

    // A launcher that, if ever called, would prove a second drain started.
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
            return makeFakeLauncher().launch(opts);
          },
        },
      ]),
      allowFull: false,
    };
    const ctx = makeCtx({ office });
    await handleRunAgent(ctx, WK, agentId);
    // wait a tick for any (incorrectly) started drain to reach launch()
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.capturedJson[0]?.status).toBe(202);
    expect((ctx.capturedJson[0]?.body as AgentBody).status).toBe("working");
    expect(launchSpy).not.toHaveBeenCalled();
  });

  // C1: prove the supervisor drain actually completes against a seeded office
  // project. Awaits drainAgent DIRECTLY (not the fire-and-forget handler) so a
  // project_not_found regression fails this test loudly.
  it("integration: drained agent reaches task done with seeded office project + audit rows", async () => {
    const { agentId } = await setupAgentWithTask();
    const coreRegistry = createInMemoryCoreRegistry();
    ensureOfficeProject(coreRegistry, () => "2026-06-22T12:00:00.000Z");
    expect(coreRegistry.getProject(OFFICE_PROJECT_ID)).not.toBeNull();

    let idN = 0;
    let tsN = 0;
    const genUuid = () => `${String(++idN).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const supervisor = createSupervisor({
      storeRoot,
      registry: createLauncherRegistry([makeFakeLauncher({ exitCode: 0 })]),
      coreRegistry,
      projectId: OFFICE_PROJECT_ID,
      now: () => `2026-06-22T13:${String(tsN++).padStart(2, "0")}:00.000Z`,
      newId: genUuid,
    });

    const processed = await supervisor.drainAgent(WK, agentId);
    expect(processed).toHaveLength(1);
    expect(processed[0]?.status).toBe("done");

    const audit = await listAudit({ storeRoot, workspaceKey: WK });
    const types = audit.map((e) => e.type);
    expect(types).toContain("spawn");
    expect(types).toContain("task_done");
  });

  it("integration: allowFull=false + full-permission role → task failed, no spawn audit", async () => {
    const FULL_ROLE = { ...ROLE_BODY, permissionMode: "full" } as const;
    const roleCtx = makeCtx({ req: makeBodyReq(FULL_ROLE), newId: () => UUID_D });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Full Agent", roleId, workdir: WORKDIR }),
      newId: () => UUID_E,
    });
    await handleCreateAgent(agentCtx, WK);
    const agentId = (agentCtx.capturedJson[0]?.body as AgentBody).id;

    const taskCtx = makeCtx({
      req: makeBodyReq({ instruction: "Full task." }),
      newId: () => UUID_F,
    });
    await handleCreateTask(taskCtx, WK, agentId);

    const coreRegistry = createInMemoryCoreRegistry();
    ensureOfficeProject(coreRegistry, () => "2026-06-22T12:00:00.000Z");
    let idN = 0;
    const supervisor = createSupervisor({
      storeRoot,
      registry: createLauncherRegistry([makeFakeLauncher()]),
      coreRegistry,
      projectId: OFFICE_PROJECT_ID,
      now: () => "2026-06-22T13:00:00.000Z",
      newId: () => `${String(++idN).padStart(8, "0")}-0000-4000-8000-000000000000`,
      allowFull: false,
    });

    const processed = await supervisor.drainAgent(WK, agentId);
    expect(processed[0]?.status).toBe("failed");
    const audit = await listAudit({ storeRoot, workspaceKey: WK });
    // Permission denied happens before session/launch → no spawn row.
    expect(audit.map((e) => e.type)).not.toContain("spawn");
  });
});

// ---------------------------------------------------------------------------
// Audit + Status
// ---------------------------------------------------------------------------

describe("handleListAudit / handleOfficeStatus", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("list audit returns empty array when no events", async () => {
    const ctx = makeCtx();
    await handleListAudit(ctx, WK);
    expect(ctx.capturedJson[0]).toMatchObject({ status: 200, body: [] });
  });

  it("status snapshot has agents array", async () => {
    const ctx = makeCtx();
    await handleOfficeStatus(ctx, WK);
    expect(ctx.capturedJson[0]?.status).toBe(200);
    const payload = ctx.capturedJson[0]?.body as StatusBody;
    expect(Array.isArray(payload.agents)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("office error mapping", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("not_found AgentOfficeError → 404 office_not_found (load non-existent agent)", async () => {
    // handleControlAgent tries to loadAgent → throws not_found
    const ctx = makeCtx({ req: makeBodyReq({ action: "pause" }) });
    await handleControlAgent(ctx, WK, UUID_A);
    expect(ctx.capturedError[0]?.status).toBe(404);
    expect(ctx.capturedError[0]?.code).toBe("office_not_found");
  });

  it("mapOfficeError: not_found → 404 office_not_found", () => {
    expect(mapOfficeError(new AgentOfficeError("not_found", "x"))).toEqual({
      status: 404,
      code: "office_not_found",
    });
  });

  it("mapOfficeError: permission_denied → 400 validation_failed", () => {
    expect(mapOfficeError(new AgentOfficeError("permission_denied", "x"))).toEqual({
      status: 400,
      code: "validation_failed",
    });
  });

  it("mapOfficeError: schema_invalid → 400 validation_failed", () => {
    expect(mapOfficeError(new AgentOfficeError("schema_invalid", "x"))).toEqual({
      status: 400,
      code: "validation_failed",
    });
  });

  it("mapOfficeError: store_corrupt → 500 internal_error", () => {
    expect(mapOfficeError(new AgentOfficeError("store_corrupt", "x"))).toEqual({
      status: 500,
      code: "internal_error",
    });
  });
});

// ---------------------------------------------------------------------------
// Workspace-key validation (C4 / security)
// ---------------------------------------------------------------------------

describe("workspace key validation", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  const BAD_WK = "../etc/passwd";

  it("listAgents rejects a malformed workspace key with 400 before any store call", async () => {
    const ctx = makeCtx();
    await handleListAgents(ctx, BAD_WK);
    expect(ctx.capturedError[0]).toMatchObject({ status: 400, code: "validation_failed" });
    expect(ctx.capturedJson).toHaveLength(0);
  });

  it("listTasks rejects a malformed workspace key with 400", async () => {
    const ctx = makeCtx();
    await handleListTasks(ctx, BAD_WK, UUID_A);
    expect(ctx.capturedError[0]).toMatchObject({ status: 400, code: "validation_failed" });
  });

  it("listAudit rejects a malformed workspace key with 400", async () => {
    const ctx = makeCtx();
    await handleListAudit(ctx, BAD_WK);
    expect(ctx.capturedError[0]).toMatchObject({ status: 400, code: "validation_failed" });
  });

  it("status rejects a malformed workspace key with 400", async () => {
    const ctx = makeCtx();
    await handleOfficeStatus(ctx, BAD_WK);
    expect(ctx.capturedError[0]).toMatchObject({ status: 400, code: "validation_failed" });
  });

  it("stream rejects a malformed workspace key with 400 (watcher path never built)", async () => {
    const ctx = makeCtx();
    await handleOfficeStream(ctx, BAD_WK);
    expect(ctx.capturedError[0]).toMatchObject({ status: 400, code: "validation_failed" });
    expect(ctx.res.writeHead as Mock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

describe("handleOfficeStream", () => {
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "office-test-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("writes SSE headers and initial snapshot event then allows cleanup", async () => {
    const writes: string[] = [];
    const fakeRes = {
      write: (chunk: string) => {
        writes.push(chunk);
      },
      writeHead: vi.fn(),
      end: vi.fn(),
      headersSent: false,
    } as unknown as ServerResponse;

    let closeHandler: (() => void) | undefined;
    const fakeReq = {
      on: (event: string, cb: () => void) => {
        if (event === "close") closeHandler = cb;
      },
    } as unknown as IncomingMessage;

    const ctx = makeCtx({ req: fakeReq, res: fakeRes });
    // Start the stream; it's long-lived so we trigger close manually
    const streamPromise = handleOfficeStream(ctx, WK);

    // Give the async snapshot build a chance to run
    await new Promise((r) => setTimeout(r, 50));

    // Trigger close to terminate the stream
    closeHandler?.();

    await streamPromise;

    // SSE headers should be written
    expect((fakeRes.writeHead as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // Initial snapshot frame should be written
    expect(writes.some((w) => w.includes("event: snapshot"))).toBe(true);
    // End should be called on close
    expect((fakeRes.end as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // C6: a disconnect that happens DURING the initial snapshot build must still
  // clean up (end called exactly once), proving cleanup is armed before the await.
  it("cleans up when the client disconnects during the initial snapshot build", async () => {
    const fakeRes = {
      write: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn(),
      headersSent: false,
    } as unknown as ServerResponse;

    let closeHandler: (() => void) | undefined;
    const fakeReq = {
      on: (event: string, cb: () => void) => {
        if (event === "close") closeHandler = cb;
      },
    } as unknown as IncomingMessage;

    const ctx = makeCtx({ req: fakeReq, res: fakeRes });
    const streamPromise = handleOfficeStream(ctx, WK);
    // Fire close synchronously — before the awaited snapshot build resolves.
    closeHandler?.();
    await streamPromise;

    expect((fakeRes.end as Mock).mock.calls.length).toBe(1);
    // After close, the watcher must never be set up (no extra ticks needed).
    await new Promise((r) => setTimeout(r, 20));
    expect((fakeRes.end as Mock).mock.calls.length).toBe(1);
  });
});
