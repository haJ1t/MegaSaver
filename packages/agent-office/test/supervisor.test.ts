import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentLauncher, LaunchHandle, LaunchInput } from "@megasaver/connectors-shared";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import {
  officeAgentIdSchema,
  officeTaskIdSchema,
  projectIdSchema,
  roleIdSchema,
  workspaceKeySchema,
} from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAgent } from "../src/agent-store.js";
import type { OfficeAgent } from "../src/agent.js";
import { listAudit } from "../src/audit-store.js";
import { createLauncherRegistry } from "../src/launcher-registry.js";
import { saveRole } from "../src/role-store.js";
import type { Role } from "../src/role.js";
import { createSupervisor } from "../src/supervisor.js";
import { saveTask } from "../src/task-store.js";
import type { OfficeTask } from "../src/task.js";

// ─── fixture helpers ────────────────────────────────────────────────────────

const WK = workspaceKeySchema.parse("0123456789abcdef");
const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "supervisor-test-"));
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: roleIdSchema.parse(randomUUID()),
    name: "Coder",
    kind: "claude-code",
    persona: "You are a senior engineer.",
    model: "sonnet",
    allowedTools: ["Bash", "Read"],
    skillPacks: [],
    permissionMode: "plan",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}

function makeAgent(roleId: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: officeAgentIdSchema.parse(randomUUID()),
    name: "Archie",
    roleId: roleIdSchema.parse(roleId),
    kind: "claude-code",
    workspaceKey: WK,
    workdir: "/repo",
    status: "idle",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}

function makeTask(agentId: string, overrides: Partial<OfficeTask> = {}): OfficeTask {
  return {
    id: officeTaskIdSchema.parse(randomUUID()),
    agentId: officeAgentIdSchema.parse(agentId),
    workspaceKey: WK,
    instruction: "Refactor the auth module.",
    status: "queued",
    queuedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}

// ─── fake launcher ───────────────────────────────────────────────────────────
// The fake launcher fires onExit immediately (synchronously) when subscribed,
// with the preset exit code. This avoids async timing issues in tests — the
// supervisor awaits the exit promise, which resolves in the same microtask.

function makeFakeLauncher(exitCode: number | null = 0): {
  launcher: AgentLauncher;
  launchCalls: LaunchInput[];
  lastInput(): LaunchInput | undefined;
} {
  const launchCalls: LaunchInput[] = [];

  const launcher: AgentLauncher = {
    kind: "claude-code",
    launch(input: LaunchInput): LaunchHandle {
      launchCalls.push(input);
      const resolvedSessionId = input.resumeSessionId ?? input.sessionId ?? `fake-${randomUUID()}`;
      return {
        sessionId: resolvedSessionId,
        onEvent(_cb) {
          // Phase 2: ignore payloads; presence proves wiring
        },
        onExit(cb) {
          // Fire immediately so the supervisor's await resolves without
          // needing extra Promise.resolve() ticks in tests.
          cb({ code: exitCode });
        },
        cancel(_signal) {},
      };
    },
  };

  return {
    launcher,
    launchCalls,
    lastInput() {
      return launchCalls[launchCalls.length - 1];
    },
  };
}

// ─── setup helpers ───────────────────────────────────────────────────────────

function seedProject(coreRegistry: CoreRegistry): void {
  coreRegistry.createProject({
    id: PROJECT_ID,
    name: "Test Project",
    rootPath: "/repo",
    createdAt: "2026-06-22T12:00:00.000Z",
    updatedAt: "2026-06-22T12:00:00.000Z",
  });
}

async function seedRoleAgent(
  storeRoot: string,
  coreRegistry: CoreRegistry,
  roleOverrides: Partial<Role> = {},
  agentOverrides: Partial<OfficeAgent> = {},
) {
  seedProject(coreRegistry);
  const role = makeRole(roleOverrides);
  const agent = makeAgent(role.id, agentOverrides);
  await saveRole({ storeRoot, role });
  await saveAgent({ storeRoot, agent });
  return { role, agent };
}

// ─── clock fixtures ───────────────────────────────────────────────────────────

function makeClock() {
  let nowCalls = 0;
  let idCounter = 0;
  const now = () => {
    nowCalls++;
    return `2026-06-22T12:${String(nowCalls).padStart(2, "0")}:00.000Z`;
  };
  const newId = () => {
    idCounter++;
    return `${String(idCounter).padStart(8, "0")}-0000-4000-8000-000000000000`;
  };
  return { now, newId };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("createSupervisor", () => {
  let storeRoot: string;
  let coreRegistry: CoreRegistry;

  beforeEach(() => {
    storeRoot = makeTmp();
    coreRegistry = createInMemoryCoreRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processNextTask — new session run", () => {
    it("queued→running→done; agent idle; core session created+ended; audit rows written", async () => {
      const { launcher } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const { now, newId } = makeClock();

      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });

      const result = await supervisor.processNextTask(WK, agent.id);

      expect(result).not.toBeNull();
      if (result === null) throw new Error("result is null");
      expect(result.status).toBe("done");
      expect(result.exitCode).toBe(0);

      // Audit rows: spawn + task_done
      const auditRows = await listAudit({ storeRoot, workspaceKey: WK });
      expect(auditRows.map((r) => r.type)).toEqual(["spawn", "task_done"]);

      // Core sessions were created + ended
      const sessions = coreRegistry.listSessions(PROJECT_ID);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.endedAt).not.toBeNull();
    });

    it("LaunchInput correct (sessionId on first run, no resumeSessionId)", async () => {
      const { launcher, launchCalls } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const role = makeRole({ model: "opus", allowedTools: ["Bash"], persona: "You are great." });
      seedProject(coreRegistry);
      await saveRole({ storeRoot, role });
      const agent = makeAgent(role.id, { workdir: "/myrepo" });
      await saveAgent({ storeRoot, agent });
      const task = makeTask(agent.id, { instruction: "Do the thing." });
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      await supervisor.processNextTask(WK, agent.id);

      const li = launchCalls[0];
      expect(li?.model).toBe("opus");
      expect(li?.persona).toBe("You are great.");
      expect(li?.allowedTools).toEqual(["Bash"]);
      expect(li?.workdir).toBe("/myrepo");
      expect(li?.permissionMode).toBe("plan");
      expect(li?.instruction).toBe("Do the thing.");
      // First run: no claudeSessionId → sessionId set, not resumeSessionId
      expect(li?.sessionId).toBeDefined();
      expect(li?.resumeSessionId).toBeUndefined();
    });

    it("session title truncated to 120 chars", async () => {
      const { launcher } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const longInstruction = "A".repeat(200);
      const task = makeTask(agent.id, { instruction: longInstruction });
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      await supervisor.processNextTask(WK, agent.id);

      const sessions = coreRegistry.listSessions(PROJECT_ID);
      expect(sessions[0]?.title).toHaveLength(120);
    });
  });

  describe("processNextTask — resume run", () => {
    it("uses resumeSessionId when agent.claudeSessionId is set", async () => {
      const PRIOR_CLAUDE_SESSION = "prior-claude-session-id";
      const { launcher, launchCalls } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(
        storeRoot,
        coreRegistry,
        {},
        {
          claudeSessionId: PRIOR_CLAUDE_SESSION,
        },
      );
      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      await supervisor.processNextTask(WK, agent.id);

      const li = launchCalls[0];
      expect(li?.resumeSessionId).toBe(PRIOR_CLAUDE_SESSION);
      expect(li?.sessionId).toBeUndefined();
    });

    it("carries handle.sessionId back to agent.claudeSessionId after success", async () => {
      const { launcher, launchCalls } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      const result = await supervisor.processNextTask(WK, agent.id);

      expect(result?.status).toBe("done");
      // The sessionId used for launch becomes the agent's claudeSessionId for next run
      const li = launchCalls[0];
      expect(li?.sessionId).toBeDefined();
    });
  });

  describe("processNextTask — failed run (non-zero exit)", () => {
    it("task failed, agent error, task_failed audit row", async () => {
      const { launcher } = makeFakeLauncher(1);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      const result = await supervisor.processNextTask(WK, agent.id);

      if (result === null) throw new Error("result is null");
      expect(result.status).toBe("failed");
      const auditRows = await listAudit({ storeRoot, workspaceKey: WK });
      expect(auditRows.some((r) => r.type === "task_failed")).toBe(true);
    });
  });

  describe("processNextTask — spawn error (exit code null)", () => {
    it("task failed, agent error when exit code is null", async () => {
      const { launcher } = makeFakeLauncher(null);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      const result = await supervisor.processNextTask(WK, agent.id);

      if (result === null) throw new Error("result is null");
      expect(result.status).toBe("failed");
      const auditRows = await listAudit({ storeRoot, workspaceKey: WK });
      expect(auditRows.some((r) => r.type === "task_failed" && r.exitCode === null)).toBe(true);
    });
  });

  describe("processNextTask — permission gate", () => {
    it("full role without allowFull: task failed, NO spawn, no launcher call, no audit row", async () => {
      const { launcher, launchCalls } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry, { permissionMode: "full" });
      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
        allowFull: false,
      });
      const result = await supervisor.processNextTask(WK, agent.id);

      if (result === null) throw new Error("result is null");
      expect(result.status).toBe("failed");
      expect(launchCalls).toHaveLength(0); // NO spawn
      const auditRows = await listAudit({ storeRoot, workspaceKey: WK });
      expect(auditRows).toHaveLength(0); // No audit row (pre-spawn failure)
    });

    it("full role WITH allowFull: spawns with full permissionMode", async () => {
      const { launcher, launchCalls } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry, { permissionMode: "full" });
      const task = makeTask(agent.id);
      await saveTask({ storeRoot, task });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
        allowFull: true,
      });
      const result = await supervisor.processNextTask(WK, agent.id);

      if (result === null) throw new Error("result is null");
      expect(result.status).toBe("done");
      expect(launchCalls[0]?.permissionMode).toBe("full");
    });
  });

  describe("processNextTask — agent not runnable states", () => {
    for (const status of ["paused", "stopped", "error"] as const) {
      it(`returns null for agent in ${status} state`, async () => {
        const { launcher } = makeFakeLauncher(0);
        const registry = createLauncherRegistry([launcher]);
        const { agent } = await seedRoleAgent(storeRoot, coreRegistry, {}, { status });
        const task = makeTask(agent.id);
        await saveTask({ storeRoot, task });
        const { now, newId } = makeClock();

        const supervisor = createSupervisor({
          storeRoot,
          registry,
          coreRegistry,
          projectId: PROJECT_ID,
          now,
          newId,
        });
        const result = await supervisor.processNextTask(WK, agent.id);
        expect(result).toBeNull();
      });
    }

    it("returns null when no queued tasks", async () => {
      const { launcher } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      const result = await supervisor.processNextTask(WK, agent.id);
      expect(result).toBeNull();
    });
  });

  describe("drainAgent", () => {
    it("processes queued tasks in queuedAt order", async () => {
      const { launcher, launchCalls } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const { now, newId } = makeClock();

      const t1 = makeTask(agent.id, {
        instruction: "First task",
        queuedAt: "2026-06-22T12:01:00.000Z",
      });
      const t2 = makeTask(agent.id, {
        instruction: "Second task",
        queuedAt: "2026-06-22T12:02:00.000Z",
      });
      // Save in reverse order to ensure sorting works
      await saveTask({ storeRoot, task: t2 });
      await saveTask({ storeRoot, task: t1 });

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      const tasks = await supervisor.drainAgent(WK, agent.id);

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.status).toBe("done");
      expect(tasks[1]?.status).toBe("done");
      // Both tasks were launched; first instruction matches first launch
      expect(launchCalls[0]?.instruction).toBe("First task");
      expect(launchCalls[1]?.instruction).toBe("Second task");
    });

    it("stops draining after a task failure", async () => {
      const { launcher, launchCalls } = makeFakeLauncher(1);
      const registry = createLauncherRegistry([launcher]);
      const { agent } = await seedRoleAgent(storeRoot, coreRegistry);
      const { now, newId } = makeClock();

      const t1 = makeTask(agent.id, { queuedAt: "2026-06-22T12:01:00.000Z" });
      const t2 = makeTask(agent.id, { queuedAt: "2026-06-22T12:02:00.000Z" });
      await saveTask({ storeRoot, task: t1 });
      await saveTask({ storeRoot, task: t2 });

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      const tasks = await supervisor.drainAgent(WK, agent.id);

      // Only one task processed (drain stops on failure)
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.status).toBe("failed");
      // Second task was never launched
      expect(launchCalls).toHaveLength(1);
    });
  });

  describe("runWorkspace", () => {
    it("drains all agents in the workspace", async () => {
      const { launcher } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);

      const role = makeRole();
      seedProject(coreRegistry);
      await saveRole({ storeRoot, role });

      const agent1 = makeAgent(role.id, { name: "A1" });
      const agent2 = makeAgent(role.id, { name: "A2" });
      await saveAgent({ storeRoot, agent: agent1 });
      await saveAgent({ storeRoot, agent: agent2 });

      const t1 = makeTask(agent1.id);
      const t2 = makeTask(agent2.id);
      await saveTask({ storeRoot, task: t1 });
      await saveTask({ storeRoot, task: t2 });
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      await supervisor.runWorkspace(WK);

      const auditRows = await listAudit({ storeRoot, workspaceKey: WK });
      // Each agent: spawn + task_done = 2 rows each × 2 agents = 4
      expect(auditRows.length).toBe(4);
    });

    it("respects maxConcurrent (no crash)", async () => {
      const { launcher } = makeFakeLauncher(0);
      const registry = createLauncherRegistry([launcher]);

      const role = makeRole();
      seedProject(coreRegistry);
      await saveRole({ storeRoot, role });

      const agents = [makeAgent(role.id), makeAgent(role.id), makeAgent(role.id)];
      for (const a of agents) {
        await saveAgent({ storeRoot, agent: a });
        await saveTask({ storeRoot, task: makeTask(a.id) });
      }
      const { now, newId } = makeClock();

      const supervisor = createSupervisor({
        storeRoot,
        registry,
        coreRegistry,
        projectId: PROJECT_ID,
        now,
        newId,
      });
      await supervisor.runWorkspace(WK, { maxConcurrent: 2 });

      const auditRows = await listAudit({ storeRoot, workspaceKey: WK });
      expect(auditRows.length).toBe(6); // 3 agents × 2 rows each
    });
  });
});
