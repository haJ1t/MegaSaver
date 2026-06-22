import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTasks } from "@megasaver/agent-office";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runOfficeAgentCreate,
  runOfficeAgentList,
  runOfficeAgentRm,
} from "../../../src/commands/office/agent.js";
import { runOfficeAssign } from "../../../src/commands/office/assign.js";
import { runOfficeRoleCreate } from "../../../src/commands/office/role.js";

const ROLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-06-22T12:00:00.000Z";

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

async function createRole(tmpDir: string) {
  const inp = makeBaseInput(tmpDir);
  await runOfficeRoleCreate({
    ...inp,
    nameFlag: "Coder",
    personaFlag: "You are a senior engineer.",
    modelFlag: "sonnet",
    permissionModeFlag: "plan",
    newId: () => ROLE_ID,
    now: () => NOW,
  });
}

describe("runOfficeAgentCreate", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-agent-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("happy path — creates agent, prints id", async () => {
    await createRole(tmpDir);
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentCreate({
      ...inp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(inp.lines[0]).toBe(AGENT_ID);
  });

  it("derives workdir from cwd (no --workdir)", async () => {
    await createRole(tmpDir);
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentCreate({
      ...inp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(inp.lines[0] ?? "{}") as { id: string; workdir: string };
    expect(parsed.id).toBe(AGENT_ID);
    expect(parsed.workdir).toBe(tmpDir);
  });

  it("json flag — prints JSON with correct id", async () => {
    await createRole(tmpDir);
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentCreate({
      ...inp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(inp.lines[0] ?? "{}") as { id: string; kind: string };
    expect(parsed.id).toBe(AGENT_ID);
    expect(parsed.kind).toBe("claude-code");
  });

  it("returns 1 for unknown role", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentCreate({
      ...inp,
      nameFlag: "Archie",
      roleIdFlag: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      newId: () => AGENT_ID,
      now: () => NOW,
    });
    expect(code).toBe(1);
    expect(inp.errs.join("")).toContain("not found");
  });
});

describe("runOfficeAgentList", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-agent-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("empty list returns 0", async () => {
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentList({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines).toHaveLength(0);
  });

  it("lists created agent", async () => {
    await createRole(tmpDir);
    const createInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...createInp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
    });

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentList({ ...inp });
    expect(code).toBe(0);
    expect(inp.lines[0]).toContain("Archie");
    expect(inp.lines[0]).toContain(AGENT_ID);
  });
});

describe("runOfficeAgentRm", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-agent-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes existing agent, returns 0", async () => {
    await createRole(tmpDir);
    const createInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...createInp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
    });

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAgentRm({ ...inp, agentId: AGENT_ID });
    expect(code).toBe(0);
    inp.lines.length = 0;
    const listCode = await runOfficeAgentList({ ...inp });
    expect(listCode).toBe(0);
    expect(inp.lines).toHaveLength(0);
  });
});

describe("runOfficeAssign", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-office-agent-test-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("assigns instruction, task is queued", async () => {
    await createRole(tmpDir);
    const agentInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...agentInp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
    });

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAssign({
      ...inp,
      agentId: AGENT_ID,
      instruction: "Refactor the auth module.",
      newId: () => TASK_ID,
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(inp.lines[0]).toBe(TASK_ID);
  });

  it("json output includes status queued", async () => {
    await createRole(tmpDir);
    const agentInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...agentInp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
    });

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAssign({
      ...inp,
      agentId: AGENT_ID,
      instruction: "Add tests.",
      newId: () => TASK_ID,
      now: () => NOW,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(inp.lines[0] ?? "{}") as { id: string; status: string };
    expect(parsed.id).toBe(TASK_ID);
    expect(parsed.status).toBe("queued");
  });

  it("I2: rejects a well-formed but nonexistent agent, no task written", async () => {
    await createRole(tmpDir);
    // Note: NO agent created.
    const inp = makeBaseInput(tmpDir);
    const GHOST_AGENT = "99999999-9999-4999-8999-999999999999";
    const code = await runOfficeAssign({
      ...inp,
      agentId: GHOST_AGENT,
      instruction: "Orphan task.",
      newId: () => TASK_ID,
      now: () => NOW,
    });
    expect(code).toBe(1);
    expect(inp.errs.join("")).toContain("agent not found");

    // No task persisted under the ghost agent.
    const wk = encodeWorkspaceKey(tmpDir);
    const tasks = await listTasks({
      storeRoot: tmpDir,
      workspaceKey: wk,
      officeAgentId: GHOST_AGENT,
    });
    expect(tasks).toHaveLength(0);
  });

  it("I1: malformed agentId produces an agent-oriented message, not 'name must be non-empty'", async () => {
    await createRole(tmpDir);
    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAssign({
      ...inp,
      agentId: "not-a-uuid",
      instruction: "Do work.",
      newId: () => TASK_ID,
      now: () => NOW,
    });
    expect(code).toBe(1);
    const errText = inp.errs.join("");
    expect(errText).not.toContain("name must be non-empty");
    expect(errText.toLowerCase()).toContain("agent");
  });

  it("I5: rejects a whitespace-only instruction (empty after trim)", async () => {
    await createRole(tmpDir);
    const agentInp = makeBaseInput(tmpDir);
    await runOfficeAgentCreate({
      ...agentInp,
      nameFlag: "Archie",
      roleIdFlag: ROLE_ID,
      newId: () => AGENT_ID,
      now: () => NOW,
    });

    const inp = makeBaseInput(tmpDir);
    const code = await runOfficeAssign({
      ...inp,
      agentId: AGENT_ID,
      instruction: "   ",
      newId: () => TASK_ID,
      now: () => NOW,
    });
    expect(code).toBe(1);

    // No task persisted.
    const wk = encodeWorkspaceKey(tmpDir);
    const tasks = await listTasks({ storeRoot: tmpDir, workspaceKey: wk, officeAgentId: AGENT_ID });
    expect(tasks).toHaveLength(0);
  });
});
