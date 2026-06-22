// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../../src/lib/claude-sessions-client.js";
import type {
  OfficeAgent,
  OfficeRole,
  OfficeStatus,
  OfficeStreamHandlers,
  OfficeTask,
} from "../../../src/lib/office-client.js";

// ── Module stubs ──────────────────────────────────────────────────────────────

const stub: {
  fetchWorkspaces: () => Promise<Workspace[]>;
  fetchOfficeStatus: (_wk: string) => Promise<OfficeStatus>;
  openOfficeStream: (_wk: string, _handlers: OfficeStreamHandlers) => () => void;
  fetchRoles: () => Promise<OfficeRole[]>;
  createAgent: (_wk: string, _input: unknown) => Promise<OfficeAgent>;
  deleteAgent: (_wk: string, _agentId: string) => Promise<void>;
  runAgent: (_wk: string, _agentId: string) => Promise<OfficeAgent>;
  controlAgent: (_wk: string, _agentId: string, _action: string) => Promise<OfficeAgent>;
  assignTask: (_wk: string, _agentId: string, _instruction: string) => Promise<OfficeTask>;
} = {
  fetchWorkspaces: () => Promise.resolve([] as Workspace[]),
  fetchOfficeStatus: (_wk: string) => Promise.resolve({ agents: [] } as OfficeStatus),
  openOfficeStream: (_wk: string, _handlers: OfficeStreamHandlers) => () => undefined,
  fetchRoles: () => Promise.resolve([] as OfficeRole[]),
  createAgent: (_wk: string, _input: unknown) => Promise.reject(new Error("not set")),
  deleteAgent: (_wk: string, _agentId: string) => Promise.reject(new Error("not set")),
  runAgent: (_wk: string, _agentId: string) => Promise.reject(new Error("not set")),
  controlAgent: (_wk: string, _agentId: string, _action: string) =>
    Promise.reject(new Error("not set")),
  assignTask: (_wk: string, _agentId: string, _instruction: string) =>
    Promise.reject(new Error("not set")),
};

vi.mock("../../../src/lib/claude-sessions-client.js", () => ({
  fetchWorkspaces: (limit: number, offset: number) => stub.fetchWorkspaces(),
}));

vi.mock("../../../src/lib/office-client.js", () => ({
  fetchRoles: () => stub.fetchRoles(),
  fetchOfficeStatus: (wk: string) => stub.fetchOfficeStatus(wk),
  openOfficeStream: (wk: string, handlers: OfficeStreamHandlers) =>
    stub.openOfficeStream(wk, handlers),
  createAgent: (wk: string, input: unknown) => stub.createAgent(wk, input),
  deleteAgent: (wk: string, agentId: string) => stub.deleteAgent(wk, agentId),
  runAgent: (wk: string, agentId: string) => stub.runAgent(wk, agentId),
  controlAgent: (wk: string, agentId: string, action: string) =>
    stub.controlAgent(wk, agentId, action),
  assignTask: (wk: string, agentId: string, instruction: string) =>
    stub.assignTask(wk, agentId, instruction),
}));

import { AgentOfficeView } from "../../../src/views/agent-office-view.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WS_1: Workspace = {
  key: "wk1",
  label: "my-project",
  sessionCount: 3,
  lastActivityMs: Date.now(),
};

const WS_2: Workspace = {
  key: "wk2",
  label: "other-project",
  sessionCount: 1,
  lastActivityMs: Date.now(),
};

const AGENT_WORKING: OfficeAgent = {
  id: "a1",
  name: "worker-1",
  roleId: "r1",
  status: "working",
  createdAt: "2026-06-22T00:00:00Z",
};

const AGENT_WK1: OfficeAgent = {
  id: "wk1-agent",
  name: "wk1-only-agent",
  roleId: "r1",
  status: "idle",
  createdAt: "2026-06-22T00:00:00Z",
};

const AGENT_WK2: OfficeAgent = {
  id: "wk2-agent",
  name: "wk2-only-agent",
  roleId: "r1",
  status: "idle",
  createdAt: "2026-06-22T00:00:00Z",
};

const STATUS_WITH_AGENT: OfficeStatus = {
  agents: [{ agent: AGENT_WORKING, currentTask: null, lastEvent: null }],
};

const STATUS_WK1: OfficeStatus = {
  agents: [{ agent: AGENT_WK1, currentTask: null, lastEvent: null }],
};

const STATUS_WK2: OfficeStatus = {
  agents: [{ agent: AGENT_WK2, currentTask: null, lastEvent: null }],
};

afterEach(() => {
  cleanup();
  stub.fetchWorkspaces = () => Promise.resolve([]);
  stub.fetchOfficeStatus = () => Promise.resolve({ agents: [] });
  stub.openOfficeStream = () => () => undefined;
  stub.fetchRoles = () => Promise.resolve([]);
  stub.createAgent = () => Promise.reject(new Error("not set"));
  stub.deleteAgent = () => Promise.reject(new Error("not set"));
  stub.runAgent = () => Promise.reject(new Error("not set"));
  stub.controlAgent = () => Promise.reject(new Error("not set"));
  stub.assignTask = () => Promise.reject(new Error("not set"));
});

describe("AgentOfficeView", () => {
  it("shows loading state then workspace selector", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1, WS_2]);
    render(<AgentOfficeView />);
    // Loading is brief, but roles loading also appears
    await waitFor(() => expect(screen.getByLabelText(/Select workspace/)).toBeDefined());
    expect(screen.getByText("my-project")).toBeDefined();
    expect(screen.getByText("other-project")).toBeDefined();
  });

  it("auto-selects workspace when only one exists", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1]);
    stub.fetchOfficeStatus = () => Promise.resolve(STATUS_WITH_AGENT);
    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());
  });

  it("workspace select drives the agent board", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1, WS_2]);
    let statusCalledWith: string | null = null;
    stub.fetchOfficeStatus = (wk) => {
      statusCalledWith = wk;
      return Promise.resolve(STATUS_WITH_AGENT);
    };
    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByLabelText(/Select workspace/)).toBeDefined());

    // Select first workspace
    fireEvent.change(screen.getByLabelText(/Select workspace/), { target: { value: "wk1" } });

    await waitFor(() => expect(statusCalledWith).toBe("wk1"));
    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());
  });

  it("SSE status event updates board state", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1]);
    // Initial status: no agents
    stub.fetchOfficeStatus = () => Promise.resolve({ agents: [] });

    // Capture handlers to simulate SSE events
    let capturedHandlers: OfficeStreamHandlers | null = null;
    stub.openOfficeStream = (_wk, handlers) => {
      capturedHandlers = handlers;
      return () => undefined;
    };

    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());

    // Simulate a status SSE event — cast to bypass overly-strict narrowing after await
    (capturedHandlers as OfficeStreamHandlers | null)?.onStatus(STATUS_WITH_AGENT);

    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());
  });

  it("does not let a late wk1 status response overwrite the wk2 board (stale-response race)", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1, WS_2]);
    stub.openOfficeStream = () => () => undefined;

    // wk1's fetch hangs; we resolve it manually AFTER switching to wk2.
    let resolveWk1: (s: OfficeStatus) => void = () => undefined;
    stub.fetchOfficeStatus = (wk) => {
      if (wk === "wk1") {
        return new Promise<OfficeStatus>((r) => {
          resolveWk1 = r;
        });
      }
      return Promise.resolve(STATUS_WK2);
    };

    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByLabelText(/Select workspace/)).toBeDefined());

    // Select wk1 (fetch hangs) then immediately switch to wk2 (resolves).
    fireEvent.change(screen.getByLabelText(/Select workspace/), { target: { value: "wk1" } });
    fireEvent.change(screen.getByLabelText(/Select workspace/), { target: { value: "wk2" } });

    await waitFor(() => expect(screen.getByText("wk2-only-agent")).toBeDefined());

    // Now the stale wk1 response arrives late — it MUST be ignored.
    resolveWk1(STATUS_WK1);

    // Give the stale promise a chance to (incorrectly) apply, then assert it didn't.
    await waitFor(() => expect(screen.getByText("wk2-only-agent")).toBeDefined());
    expect(screen.queryByText("wk1-only-agent")).toBeNull();
  });

  it("clears the disconnect banner when a live status push follows an onError blip", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1]);
    stub.fetchOfficeStatus = () => Promise.resolve({ agents: [] });

    let capturedHandlers: OfficeStreamHandlers | null = null;
    stub.openOfficeStream = (_wk, handlers) => {
      capturedHandlers = handlers;
      return () => undefined;
    };

    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());

    // Transient blip — EventSource auto-reconnects but fires onError first.
    (capturedHandlers as OfficeStreamHandlers | null)?.onError();
    await waitFor(() => expect(screen.getByText(/Live stream disconnected/)).toBeDefined());

    // Reconnect delivers a fresh status push — the banner must clear.
    (capturedHandlers as OfficeStreamHandlers | null)?.onStatus(STATUS_WITH_AGENT);

    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());
    expect(screen.queryByText(/Live stream disconnected/)).toBeNull();
  });

  it("closes stream on workspace change", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1, WS_2]);
    stub.fetchOfficeStatus = () => Promise.resolve({ agents: [] });

    let closeCalled = 0;
    stub.openOfficeStream = () => () => {
      closeCalled++;
    };

    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByLabelText(/Select workspace/)).toBeDefined());

    // Select wk1
    fireEvent.change(screen.getByLabelText(/Select workspace/), { target: { value: "wk1" } });
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());

    // Select wk2 — should close wk1 stream
    fireEvent.change(screen.getByLabelText(/Select workspace/), { target: { value: "wk2" } });
    await waitFor(() => expect(closeCalled).toBeGreaterThan(0));
  });

  it("closes stream on unmount", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1]);
    stub.fetchOfficeStatus = () => Promise.resolve({ agents: [] });

    let closeCalled = false;
    stub.openOfficeStream = () => () => {
      closeCalled = true;
    };

    const { unmount } = render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());

    unmount();
    expect(closeCalled).toBe(true);
  });

  it("always renders RoleManager (global roles section)", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1, WS_2]);
    render(<AgentOfficeView />);
    await waitFor(() => expect(screen.getByLabelText(/Select workspace/)).toBeDefined());
    // The Roles heading is an h2 — check for heading element specifically
    await waitFor(() => expect(screen.getAllByText(/Roles/i).length).toBeGreaterThan(0));
  });

  it("shows prompt to select workspace when multiple workspaces and none selected", async () => {
    stub.fetchWorkspaces = () => Promise.resolve([WS_1, WS_2]);
    render(<AgentOfficeView />);
    await waitFor(() =>
      expect(screen.getByText(/Select a workspace to view and manage agents/)).toBeDefined(),
    );
  });
});
