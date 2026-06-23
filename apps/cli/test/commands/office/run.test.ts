import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLauncherRegistry } from "@megasaver/agent-office";
import type { AgentLauncher, LaunchHandle } from "@megasaver/connectors-shared";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { AgentId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOfficeAgentCreate } from "../../../src/commands/office/agent.js";
import { runOfficeAssign } from "../../../src/commands/office/assign.js";
import { runOfficeControl } from "../../../src/commands/office/control.js";
import { runOfficeLogs } from "../../../src/commands/office/logs.js";
import { runOfficeRoleCreate } from "../../../src/commands/office/role.js";
import { runOfficeRun } from "../../../src/commands/office/run.js";
import { runOfficeStatus } from "../../../src/commands/office/status.js";

// ─── fixed ids ────────────────────────────────────────────────────────────────

const ROLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUDIT_ID1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AUDIT_ID2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOW = "2026-06-22T12:00:00.000Z";

// ─── fake launcher factory ────────────────────────────────────────────────────

function makeFakeLauncher(exitCode: number | null = 0): AgentLauncher {
  return {
    kind: "claude-code" as AgentId,
    launch(): LaunchHandle {
      return {
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        onEvent: () => {},
        onExit(cb) {
          // Fire synchronously after one microtask tick (mirrors supervisor test pattern)
          Promise.resolve().then(() => cb({ code: exitCode }));
        },
        cancel: vi.fn(),
      };
    },
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeBaseInput(tmpDir: string) {
  const lines: string[] = [];
  const errs: string[] = [];
  return {
    storeFlag: tmpDir,
    cwd: tmpDir,
    home: tmpDir,
    xdgDataHome: undefined as string | undefined,
    platform: process.platform,
    localAppData: undefined as string | undefined,
    stdout: (line: string) => lines.push(line),
    stderr: (line: string) => errs.push(line),
    lines,
    errs,
  };
}

// ID sequence for supervisor newId calls
function makeIdSeq(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++ % ids.length] ?? crypto.randomUUID();
}

async function setupRoleAndAgent(tmpDir: string) {
  const roleInp = makeBaseInput(tmpDir);
  await runOfficeRoleCreate({
    ...roleInp,
    nameFlag: "Coder",
    personaFlag: "You are a senior engineer.",
    modelFlag: "sonnet",
    permissionModeFlag: "plan",
    newId: () => ROLE_ID,
    now: () => NOW,
  });

  const agentInp = makeBaseInput(tmpDir);
  await runOfficeAgentCreate({
    ...agentInp,
    nameFlag: "Archie",
    roleIdFlag: ROLE_ID,
    newId: () => AGENT_ID,
    now: () => NOW,
  });
}

async function assignTask(tmpDir: string, taskId = TASK_ID) {
  const inp = makeBaseInput(tmpDir);
  await runOfficeAssign({
    ...inp,
    agentId: AGENT_ID,
    instruction: "Refactor the auth module.",
    newId: () => taskId,
    now: () => NOW,
  });
}

// ─── run tests ───────────────────────────────────────────────────────────────

describe("runOfficeRun", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-run-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drains queued task to done (fake launcher exit 0), exits 0", async () => {
    await setupRoleAndAgent(tmpDir);
    await assignTask(tmpDir);

    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeRun({
      ...inp,
      agentId: AGENT_ID,
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(0);
    expect(inp.lines.join("")).toContain("done");
  });

  it("fake launcher exit 1 → task failed, exits 1", async () => {
    await setupRoleAndAgent(tmpDir);
    await assignTask(tmpDir);

    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(1)]);

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeRun({
      ...inp,
      agentId: AGENT_ID,
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(1);
    expect(inp.lines.join("")).toContain("failed");
  });

  it("full role WITHOUT --allow-full → task failed (permission denied), no spawn, exits 1", async () => {
    // Create a role with full permission mode
    const roleInp = makeBaseInput(tmpDir);
    const FULL_ROLE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await runOfficeRoleCreate({
      ...roleInp,
      nameFlag: "FullCoder",
      personaFlag: "Full permission agent.",
      modelFlag: "sonnet",
      permissionModeFlag: "full",
      newId: () => FULL_ROLE_ID,
      now: () => NOW,
    });

    const FULL_AGENT_ID = "11111111-1111-4111-8111-111111111111";
    const agentInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...agentInp,
      nameFlag: "FullArchie",
      roleIdFlag: FULL_ROLE_ID,
      newId: () => FULL_AGENT_ID,
      now: () => NOW,
    });

    const taskInp = makeBaseInput(tmpDir);
    await runOfficeAssign({
      ...taskInp,
      agentId: FULL_AGENT_ID,
      instruction: "Do dangerous things.",
      newId: () => TASK_ID,
      now: () => NOW,
    });

    const launchSpy = vi.fn();
    const spyLauncher: AgentLauncher = {
      kind: "claude-code" as AgentId,
      launch: launchSpy,
    };
    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([spyLauncher]);

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeRun({
      ...inp,
      agentId: FULL_AGENT_ID,
      allowFull: false, // NOT allowed
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(1);
    expect(launchSpy).not.toHaveBeenCalled(); // no spawn
    expect(inp.lines.join("")).toContain("failed");
  });

  it("full role WITH --allow-full → spawns, exits 0", async () => {
    const FULL_ROLE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const roleInp = makeBaseInput(tmpDir);
    await runOfficeRoleCreate({
      ...roleInp,
      nameFlag: "FullCoder",
      personaFlag: "Full permission agent.",
      modelFlag: "sonnet",
      permissionModeFlag: "full",
      newId: () => FULL_ROLE_ID,
      now: () => NOW,
    });

    const FULL_AGENT_ID = "11111111-1111-4111-8111-111111111111";
    const agentInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...agentInp,
      nameFlag: "FullArchie",
      roleIdFlag: FULL_ROLE_ID,
      newId: () => FULL_AGENT_ID,
      now: () => NOW,
    });

    const taskInp = makeBaseInput(tmpDir);
    await runOfficeAssign({
      ...taskInp,
      agentId: FULL_AGENT_ID,
      instruction: "Do allowed things.",
      newId: () => TASK_ID,
      now: () => NOW,
    });

    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeRun({
      ...inp,
      agentId: FULL_AGENT_ID,
      allowFull: true, // explicitly allowed
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(0);
    expect(inp.lines.join("")).toContain("done");
  });

  it("ensureOfficeProject seeds the office project (no project_not_found)", async () => {
    await setupRoleAndAgent(tmpDir);
    await assignTask(tmpDir);

    // Provide a FRESH empty core registry — ensureOfficeProject must seed it
    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);

    const inp = makeBaseInput(tmpDir);
    // Should NOT throw project_not_found
    const code = await runOfficeRun({
      ...inp,
      agentId: AGENT_ID,
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(0);
  });

  it("json output includes id/status/exitCode", async () => {
    await setupRoleAndAgent(tmpDir);
    await assignTask(tmpDir);

    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);

    const inp = makeBaseInput(tmpDir);
    await runOfficeRun({
      ...inp,
      agentId: AGENT_ID,
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
      json: true,
    });

    const parsed = JSON.parse(inp.lines[0] ?? "[]") as Array<{
      id: string;
      status: string;
      exitCode: number | null;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.status).toBe("done");
  });

  it("I4: unknown agent → 'agent not found', exits 1", async () => {
    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeRun({
      ...inp,
      agentId: "99999999-9999-4999-8999-999999999999",
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(1);
    expect(inp.errs.join("")).toContain("agent not found");
  });

  it("I3: no queued task → stderr note, exits 0", async () => {
    await setupRoleAndAgent(tmpDir);
    // No assignTask — the agent is idle with an empty queue.

    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeRun({
      ...inp,
      agentId: AGENT_ID,
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    expect(code).toBe(0);
    const errText = inp.errs.join("");
    expect(errText).toContain(`no tasks drained for ${AGENT_ID}`);
    expect(errText).toContain("status=idle");
  });

  it("MEGA_OFFICE_ALLOW_FULL=1 → full role runs without --allow-full flag", async () => {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const prev = process.env["MEGA_OFFICE_ALLOW_FULL"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_OFFICE_ALLOW_FULL"] = "1";
    try {
      const FULL_ROLE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      const roleInp = makeBaseInput(tmpDir);
      await runOfficeRoleCreate({
        ...roleInp,
        nameFlag: "FullCoder",
        personaFlag: "Full permission agent.",
        modelFlag: "sonnet",
        permissionModeFlag: "full",
        newId: () => FULL_ROLE_ID,
        now: () => NOW,
      });

      const FULL_AGENT_ID = "11111111-1111-4111-8111-111111111111";
      const agentInp = makeBaseInput(tmpDir);
      await runOfficeAgentCreate({
        ...agentInp,
        nameFlag: "FullArchie",
        roleIdFlag: FULL_ROLE_ID,
        newId: () => FULL_AGENT_ID,
        now: () => NOW,
      });

      const taskInp = makeBaseInput(tmpDir);
      await runOfficeAssign({
        ...taskInp,
        agentId: FULL_AGENT_ID,
        instruction: "Do allowed things.",
        newId: () => TASK_ID,
        now: () => NOW,
      });

      const launchSpy = vi.fn(
        (): LaunchHandle => ({
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          onEvent: () => {},
          onExit(cb) {
            Promise.resolve().then(() => cb({ code: 0 }));
          },
          cancel: vi.fn(),
        }),
      );
      const spyLauncher: AgentLauncher = {
        kind: "claude-code" as AgentId,
        launch: launchSpy,
      };
      const coreRegistry = createInMemoryCoreRegistry();
      const registry = createLauncherRegistry([spyLauncher]);

      const inp = makeBaseInput(tmpDir);
      const code = await runOfficeRun({
        ...inp,
        agentId: FULL_AGENT_ID,
        // NOTE: no allowFull flag — relies on env var
        registry,
        coreRegistry,
        newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
        now: () => NOW,
      });

      expect(code).toBe(0);
      expect(launchSpy).toHaveBeenCalledTimes(1); // spawned despite no flag
      expect(inp.lines.join("")).toContain("done");
    } finally {
      if (prev === undefined) {
        // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
        // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
        delete process.env["MEGA_OFFICE_ALLOW_FULL"];
      } else {
        // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
        process.env["MEGA_OFFICE_ALLOW_FULL"] = prev;
      }
    }
  });
});

// ─── control tests ────────────────────────────────────────────────────────────

describe("runOfficeControl", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-control-test-"));
    await setupRoleAndAgent(tmpDir);
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pause transitions agent to paused", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeControl({ ...inp, agentId: AGENT_ID, action: "pause" });
    expect(code).toBe(0);
    expect(inp.lines[0]).toContain("paused");
  });

  it("resume transitions agent to idle", async () => {
    const pauseInp = makeBaseInput(tmpDir);
    await runOfficeControl({ ...pauseInp, agentId: AGENT_ID, action: "pause" });
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeControl({ ...inp, agentId: AGENT_ID, action: "resume" });
    expect(code).toBe(0);
    expect(inp.lines[0]).toContain("idle");
  });

  it("stop transitions agent to stopped", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeControl({ ...inp, agentId: AGENT_ID, action: "stop" });
    expect(code).toBe(0);
    expect(inp.lines[0]).toContain("stopped");
  });
});

// ─── status tests ─────────────────────────────────────────────────────────────

describe("runOfficeStatus", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-status-test-"));
    await setupRoleAndAgent(tmpDir);
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns status for all agents", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeStatus({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines[0]).toContain(AGENT_ID);
  });

  it("json output has agents array", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeStatus({ ...inp, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(inp.lines[0] ?? "{}") as { agents: unknown[] };
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents).toHaveLength(1);
  });

  it("filters to specific agent when agentId given", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeStatus({ ...inp, agentId: AGENT_ID, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(inp.lines[0] ?? "{}") as { agents: unknown[] };
    expect(parsed.agents).toHaveLength(1);
  });
});

// ─── logs tests ───────────────────────────────────────────────────────────────

describe("runOfficeLogs", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-logs-test-"));
    await setupRoleAndAgent(tmpDir);
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty log for fresh workspace", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeLogs({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines).toHaveLength(0);
  });

  it("returns audit rows after a run", async () => {
    await assignTask(tmpDir);
    const coreRegistry = createInMemoryCoreRegistry();
    const registry = createLauncherRegistry([makeFakeLauncher(0)]);
    const runInp = makeBaseInput(tmpDir);
    await runOfficeRun({
      ...runInp,
      agentId: AGENT_ID,
      registry,
      coreRegistry,
      newId: makeIdSeq([AUDIT_ID1, AUDIT_ID2]),
      now: () => NOW,
    });

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeLogs({ ...inp, json: true });
    expect(code).toBe(0);
    const events = JSON.parse(inp.lines[0] ?? "[]") as unknown[];
    expect(events.length).toBeGreaterThan(0);
  });

  it("json output is an array", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeLogs({ ...inp, json: true });
    expect(code).toBe(0);
    const events = JSON.parse(inp.lines[0] ?? "[]") as unknown[];
    expect(Array.isArray(events)).toBe(true);
  });
});
