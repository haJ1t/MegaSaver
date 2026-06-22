import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentOfficeError, createLauncherRegistry } from "@megasaver/agent-office";
import type { AgentLauncher, LaunchHandle } from "@megasaver/connectors-shared";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { AgentId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeContext, RouteContext } from "../../../bridge/route-context.js";
import {
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
} from "../../../bridge/routes/office.js";

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
    resolveWorkspace: async () => null,
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
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const req = {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
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
// Workspace key used in tests (16 lowercase hex chars — workspaceKeySchema)
// ---------------------------------------------------------------------------
const WK = "0000000000000001";

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
    const role = ctx.capturedJson[0]?.body as Record<string, unknown>;
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

  it("delete role → 200 with id", async () => {
    // First create the role
    const createCtx = makeCtx({ req: makeBodyReq(ROLE_BODY) });
    await handleCreateRole(createCtx);
    const roleId = (createCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    const delCtx = makeCtx();
    await handleDeleteRole(delCtx, roleId);
    expect(delCtx.capturedJson[0]?.status).toBe(200);
  });

  it("delete role with bad id → 404", async () => {
    const ctx = makeCtx();
    await handleDeleteRole(ctx, "not-a-uuid");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });

  it("sendError 500 when office not configured", async () => {
    const ctx = makeCtx({ office: undefined });
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
    const roleId = (roleCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;
    expect(roleId).toBe(UUID_A);

    // Create agent (uses UUID_B for id)
    const agentBody = { name: "My Agent", roleId, workdir: "/tmp/workdir" };
    const agentCtx = makeCtx({ req: makeBodyReq(agentBody), newId: () => UUID_B });
    await handleCreateAgent(agentCtx, WK);
    expect(agentCtx.capturedJson[0]?.status).toBe(201);
    const agent = agentCtx.capturedJson[0]?.body as Record<string, unknown>;
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

  it("delete agent → 200", async () => {
    // Create role
    const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_C });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    // Create agent
    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Del Agent", roleId, workdir: "/tmp" }),
      newId: () => UUID_D,
    });
    await handleCreateAgent(agentCtx, WK);
    const agentId = (agentCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;
    expect(agentId).toBe(UUID_D);

    // Delete
    const delCtx = makeCtx();
    await handleDeleteAgent(delCtx, WK, agentId);
    expect(delCtx.capturedJson[0]?.status).toBe(200);
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
    const task = ctx.capturedJson[0]?.body as Record<string, unknown>;
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
    const roleBody = roleCtx.capturedJson[0]?.body as Record<string, unknown>;
    const roleId = roleBody.id as string;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Ctrl Agent", roleId, workdir: "/tmp" }),
      newId: () => UUID_B,
    });
    await handleCreateAgent(agentCtx, WK);
    expect(agentCtx.capturedJson[0]?.status).toBe(201);
    const agentBody = agentCtx.capturedJson[0]?.body as Record<string, unknown>;
    return agentBody.id as string;
  }

  it("pause → status paused", async () => {
    const agentId = await createAgentInStore();
    const ctx = makeCtx({ req: makeBodyReq({ action: "pause" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect(ctx.capturedJson[0]?.status).toBe(200);
    expect((ctx.capturedJson[0]?.body as Record<string, unknown>).status).toBe("paused");
  });

  it("resume → status idle", async () => {
    const agentId = await createAgentInStore();
    const pauseCtx = makeCtx({ req: makeBodyReq({ action: "pause" }) });
    await handleControlAgent(pauseCtx, WK, agentId);

    const ctx = makeCtx({ req: makeBodyReq({ action: "resume" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect((ctx.capturedJson[0]?.body as Record<string, unknown>).status).toBe("idle");
  });

  it("stop → status stopped", async () => {
    const agentId = await createAgentInStore();
    const ctx = makeCtx({ req: makeBodyReq({ action: "stop" }) });
    await handleControlAgent(ctx, WK, agentId);
    expect((ctx.capturedJson[0]?.body as Record<string, unknown>).status).toBe("stopped");
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
    const roleId = (roleCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Run Agent", roleId, workdir: storeRoot }),
      newId: () => UUID_B,
    });
    await handleCreateAgent(agentCtx, WK);
    const agentId = (agentCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    const taskCtx = makeCtx({
      req: makeBodyReq({ instruction: "Do something." }),
      newId: () => UUID_C,
    });
    await handleCreateTask(taskCtx, WK, agentId);
    const taskId = (taskCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    return { agentId, taskId };
  }

  it("returns 202 with agent snapshot immediately (fire-and-forget)", async () => {
    const { agentId } = await setupAgentWithTask();
    const ctx = makeCtx();
    await handleRunAgent(ctx, WK, agentId);
    expect(ctx.capturedJson[0]?.status).toBe(202);
    const agent = ctx.capturedJson[0]?.body as Record<string, unknown>;
    expect(agent.id).toBe(agentId);
  });

  it("non-uuid agent id → 404", async () => {
    const ctx = makeCtx();
    await handleRunAgent(ctx, WK, "bad-id");
    expect(ctx.capturedError[0]?.status).toBe(404);
  });

  it("run with allowFull=false and full-permission role → handler still returns 202 (fire-and-forget)", async () => {
    // Supervisor may fail internally (permission denied) but that's fire-and-forget.
    // Handler always returns 202 immediately after kicking off the supervisor.
    const FULL_ROLE = { ...ROLE_BODY, permissionMode: "full" } as const;
    const roleCtx = makeCtx({ req: makeBodyReq(FULL_ROLE), newId: () => UUID_D });
    await handleCreateRole(roleCtx);
    const roleId = (roleCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    const agentCtx = makeCtx({
      req: makeBodyReq({ name: "Full Agent", roleId, workdir: storeRoot }),
      newId: () => UUID_E,
    });
    await handleCreateAgent(agentCtx, WK);
    const agentId = (agentCtx.capturedJson[0]?.body as Record<string, unknown>).id as string;

    const taskCtx = makeCtx({
      req: makeBodyReq({ instruction: "Full task." }),
      newId: () => UUID_F,
    });
    await handleCreateTask(taskCtx, WK, agentId);

    // Use a context where office is known (allowFull: false is the default)
    const office: OfficeContext = {
      coreRegistry: createInMemoryCoreRegistry(),
      registry: createLauncherRegistry([makeFakeLauncher()]),
      allowFull: false,
    };
    const ctx = makeCtx({ office });
    await handleRunAgent(ctx, WK, agentId);
    // Should still 202 (fire-and-forget; permission failure is internal)
    expect(ctx.capturedJson[0]?.status).toBe(202);
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
    const payload = ctx.capturedJson[0]?.body as Record<string, unknown>;
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
});
