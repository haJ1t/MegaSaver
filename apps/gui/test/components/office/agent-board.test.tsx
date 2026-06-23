// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OfficeAgent,
  OfficeAuditEvent,
  OfficeRole,
  OfficeStatus,
  OfficeTask,
} from "../../../src/lib/office-client.js";

// ── Module stubs ──────────────────────────────────────────────────────────────

const stub: {
  fetchRoles: () => Promise<OfficeRole[]>;
  createAgent: (_wk: string, _input: unknown) => Promise<OfficeAgent>;
  deleteAgent: (_wk: string, _agentId: string) => Promise<void>;
  runAgent: (_wk: string, _agentId: string) => Promise<OfficeAgent>;
  controlAgent: (_wk: string, _agentId: string, _action: string) => Promise<OfficeAgent>;
  assignTask: (_wk: string, _agentId: string, _instruction: string) => Promise<OfficeTask>;
  fetchTranscript: (_wk: string, _agentId: string) => Promise<unknown[]>;
} = {
  fetchRoles: () => Promise.resolve([] as OfficeRole[]),
  createAgent: (_wk: string, _input: unknown) => Promise.reject(new Error("not set")),
  deleteAgent: (_wk: string, _agentId: string) => Promise.reject(new Error("not set")),
  runAgent: (_wk: string, _agentId: string) => Promise.reject(new Error("not set")),
  controlAgent: (_wk: string, _agentId: string, _action: string) =>
    Promise.reject(new Error("not set")),
  assignTask: (_wk: string, _agentId: string, _instruction: string) =>
    Promise.reject(new Error("not set")),
  fetchTranscript: (_wk: string, _agentId: string) => Promise.resolve([]),
};

vi.mock("../../../src/lib/office-client.js", () => ({
  fetchRoles: () => stub.fetchRoles(),
  createAgent: (wk: string, input: unknown) => stub.createAgent(wk, input),
  deleteAgent: (wk: string, agentId: string) => stub.deleteAgent(wk, agentId),
  runAgent: (wk: string, agentId: string) => stub.runAgent(wk, agentId),
  controlAgent: (wk: string, agentId: string, action: string) =>
    stub.controlAgent(wk, agentId, action),
  assignTask: (wk: string, agentId: string, instruction: string) =>
    stub.assignTask(wk, agentId, instruction),
  fetchTranscript: (wk: string, agentId: string) => stub.fetchTranscript(wk, agentId),
  openTranscriptStream: () => () => undefined,
}));

import { AgentBoard } from "../../../src/views/office/agent-board.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROLE_1: OfficeRole = {
  id: "r1",
  name: "coder",
  kind: "claude-code",
  permissionMode: "plan",
  allowedTools: [],
  createdAt: "2026-06-22T00:00:00Z",
};

const AGENT_WORKING: OfficeAgent = {
  id: "a1",
  name: "worker-1",
  roleId: "r1",
  status: "working",
  createdAt: "2026-06-22T00:00:00Z",
};

const AGENT_IDLE: OfficeAgent = {
  id: "a2",
  name: "idle-agent",
  roleId: "r1",
  status: "idle",
  createdAt: "2026-06-22T00:00:00Z",
};

const TASK_1: OfficeTask = {
  id: "t1",
  agentId: "a1",
  instruction: "Implement the feature",
  status: "running",
  createdAt: "2026-06-22T00:00:00Z",
};

const AUDIT_EVENT_1: OfficeAuditEvent = {
  id: "e1",
  agentId: "a1",
  type: "task_started",
  ts: new Date(Date.now() - 60000).toISOString(),
};

const STATUS: OfficeStatus = {
  agents: [
    { agent: AGENT_WORKING, currentTask: TASK_1, lastEvent: AUDIT_EVENT_1 },
    { agent: AGENT_IDLE, currentTask: null, lastEvent: null },
  ],
};

afterEach(() => {
  cleanup();
  stub.fetchRoles = () => Promise.resolve([]);
  stub.createAgent = () => Promise.reject(new Error("not set"));
  stub.deleteAgent = () => Promise.reject(new Error("not set"));
  stub.runAgent = () => Promise.reject(new Error("not set"));
  stub.controlAgent = () => Promise.reject(new Error("not set"));
  stub.assignTask = () => Promise.reject(new Error("not set"));
  stub.fetchTranscript = () => Promise.resolve([]);
});

describe("AgentBoard", () => {
  it("renders empty state when status has no agents", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={{ agents: [] }}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());
  });

  it("renders agent cards from status payload with status dot and task", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => undefined}
      />,
    );

    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());
    expect(screen.getByText("idle-agent")).toBeDefined();

    // Status dot for working agent
    const workingDot = screen.getByTestId("agent-card-a1").querySelector("[data-status]");
    expect(workingDot?.getAttribute("data-status")).toBe("working");

    // Current task instruction shown
    expect(screen.getByText("Implement the feature")).toBeDefined();

    // Last event shown
    await waitFor(() => expect(screen.getByText(/task_started/)).toBeDefined());
  });

  it("shows status dot with correct data-status for idle agent", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("idle-agent")).toBeDefined());

    const idleDot = screen.getByTestId("agent-card-a2").querySelector("[data-status]");
    expect(idleDot?.getAttribute("data-status")).toBe("idle");
  });

  it("run button calls runAgent and triggers refresh", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let refreshCalled = false;
    let runCalledWith: { wk: string; agentId: string } | null = null;
    stub.runAgent = (wk, agentId) => {
      runCalledWith = { wk, agentId };
      return Promise.resolve(AGENT_IDLE);
    };
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => {
          refreshCalled = true;
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText("idle-agent")).toBeDefined());

    // The idle agent's Run button (not disabled)
    const cards = screen.getAllByRole("button", { name: /^Run$/ });
    const idleRunBtn = cards[1]; // second card is idle
    if (idleRunBtn) fireEvent.click(idleRunBtn);

    await waitFor(() => expect(refreshCalled).toBe(true));
    expect(runCalledWith).toMatchObject({ wk: "wk1", agentId: "a2" });
  });

  it("pause button calls controlAgent with pause", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let capturedAction: string | null = null;
    stub.controlAgent = (_wk, _agentId, action) => {
      capturedAction = action;
      return Promise.resolve({ ...AGENT_WORKING, status: "paused" });
    };
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /^Pause$/ }));
    await waitFor(() => expect(capturedAction).toBe("pause"));
  });

  it("stop button calls controlAgent with stop", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let capturedAction: string | null = null;
    stub.controlAgent = (_wk, _agentId, action) => {
      capturedAction = action;
      return Promise.resolve({ ...AGENT_WORKING, status: "stopped" });
    };
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());

    // Stop button for working agent (not disabled)
    const stopBtns = screen.getAllByRole("button", { name: /^Stop$/ });
    if (stopBtns[0]) fireEvent.click(stopBtns[0]);
    await waitFor(() => expect(capturedAction).toBe("stop"));
  });

  it("remove confirms and calls deleteAgent", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let deletedAgentId: string | null = null;
    stub.deleteAgent = (_wk, agentId) => {
      deletedAgentId = agentId;
      return Promise.resolve();
    };
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("idle-agent")).toBeDefined());

    // Click remove on idle agent
    fireEvent.click(screen.getByLabelText(/Remove agent idle-agent/));
    await waitFor(() => expect(screen.getAllByText("Remove?").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Yes")[0] as Element);
    await waitFor(() => expect(deletedAgentId).toBe("a2"));
  });

  it("assign form posts instruction via assignTask", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let capturedInstruction: string | null = null;
    stub.assignTask = (_wk, _agentId, instruction) => {
      capturedInstruction = instruction;
      return Promise.resolve({
        id: "t2",
        agentId: "a2",
        instruction,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    };
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={STATUS}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText("idle-agent")).toBeDefined());

    // Open assign form on idle agent card (a2) using within scoping
    const idleCard = screen.getByTestId("agent-card-a2");
    const idleScope = within(idleCard);
    fireEvent.click(idleScope.getByRole("button", { name: /^Assign$/ }));

    await waitFor(() => expect(idleScope.getByLabelText(/Task instruction/)).toBeDefined());
    fireEvent.change(idleScope.getByLabelText(/Task instruction/), {
      target: { value: "Run tests" },
    });
    // After opening form, there's both toggle (button) and submit (button) — use submit type
    const assignForm = idleCard.querySelector("form") as HTMLFormElement;
    fireEvent.click(within(assignForm).getByRole("button", { name: /^Assign$/ }));

    await waitFor(() => expect(capturedInstruction).toBe("Run tests"));
  });

  it("add-agent form posts to createAgent and triggers refresh", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let refreshCalled = false;
    let capturedInput: unknown;
    stub.createAgent = (wk, input) => {
      capturedInput = input;
      return Promise.resolve({ ...AGENT_IDLE, id: "a3" });
    };
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={{ agents: [] }}
        onRefresh={() => {
          refreshCalled = true;
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());

    fireEvent.click(screen.getByText(/\+ Add agent/));
    await waitFor(() => expect(screen.getByLabelText(/Add agent form/)).toBeDefined());

    fireEvent.change(screen.getByLabelText(/Name \*/), { target: { value: "new-agent" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(refreshCalled).toBe(true));
    expect(capturedInput).toMatchObject({ name: "new-agent", workdir: "/home/user/project" });
  });

  it("renders no workdir input in the add-agent form", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    render(
      <AgentBoard
        wk="wk1"
        workdir="/home/user/project"
        status={{ agents: [] }}
        onRefresh={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());
    fireEvent.click(screen.getByText(/\+ Add agent/));
    await waitFor(() => expect(screen.getByLabelText(/Add agent form/)).toBeDefined());
    expect(screen.queryByLabelText(/Workdir/i)).toBeNull();
  });

  it("clicking an agent card opens its transcript panel", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let calledWith: { wk: string; agentId: string } | null = null;
    stub.fetchTranscript = (wk, agentId) => {
      calledWith = { wk, agentId };
      return Promise.resolve([]);
    };
    render(
      <AgentBoard wk="wk1" workdir="/home/user/project" status={STATUS} onRefresh={() => undefined} />,
    );
    await waitFor(() => expect(screen.getByText("idle-agent")).toBeDefined());

    fireEvent.click(screen.getByLabelText(/View activity for idle-agent/));
    await waitFor(() => expect(calledWith).toEqual({ wk: "wk1", agentId: "a2" }));
  });
});
