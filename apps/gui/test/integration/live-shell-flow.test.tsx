// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeSessionMeta,
  SessionTelemetry,
  StreamHandlers,
} from "../../src/lib/claude-sessions-client.js";
import { installLocalStoragePolyfill } from "../support/local-storage-polyfill.js";

const SESSION: ClaudeSessionMeta = {
  dir: "proj",
  id: "sess-1",
  mtimeMs: Date.now(),
  size: 10,
  title: "My session",
  projectLabel: "/tmp/alpha",
  isArchived: false,
  model: "claude-opus-4-8-20260101",
  permissionMode: "default",
  lastActivityAt: Date.now(),
};

const TELEMETRY: SessionTelemetry = {
  turnCount: 5,
  assistantTurns: 2,
  toolCallCount: 1,
  totals: {
    inputTokens: 111,
    outputTokens: 222,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  },
  models: [],
  firstTs: "2026-06-14T00:00:00.000Z",
  lastTs: "2026-06-14T00:01:00.000Z",
  durationMs: 60000,
  gitBranch: "main",
};

vi.mock("../../src/lib/user-projects-client.js", () => ({
  fetchUserProjects: () =>
    Promise.resolve({
      paths: ["/tmp/alpha"],
      workspaces: [{ key: "208b3cad4befbe80", cwd: "/tmp/alpha", label: "alpha" }],
    }),
  addUserProject: () =>
    Promise.resolve({
      paths: ["/tmp/alpha"],
      workspaces: [{ key: "208b3cad4befbe80", cwd: "/tmp/alpha", label: "alpha" }],
    }),
  removeUserProject: () => Promise.resolve({ paths: [], workspaces: [] }),
}));
vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: () => Promise.resolve([SESSION]),
  fetchAllWorkspaceTotals: () =>
    Promise.resolve({
      bytesSavedTotal: 0,
      sessionsCount: 0,
      savingRatio: 0,
      workspaceCount: 0,
    }),
  fetchClaudeSessionTelemetry: () => Promise.resolve(TELEMETRY),
  fetchSessionTokenSaverStats: () => Promise.resolve(null),
  fetchWorkspaceTokenSaverStats: () => Promise.resolve(null),
  fetchDaemonStatus: () => Promise.resolve({ running: true }),
  // Overview mounts first and probes readiness; stub the three status routes.
  fetchClaudeHookStatus: () =>
    Promise.resolve({ connected: true, preInstalled: true, postInstalled: true }),
  fetchProxyStatus: () =>
    Promise.resolve({
      enabled: true,
      routed: true,
      routeConflict: false,
      reconcileBlocked: false,
      draining: false,
      url: "http://127.0.0.1:7431",
    }),
  openClaudeSessionStream: (_dir: string, _id: string, handlers: StreamHandlers) => {
    handlers.onSnapshot({
      projectLabel: "/tmp/alpha",
      messages: [
        { role: "assistant", ts: "t1", blocks: [{ kind: "text", text: "transcript body" }] },
      ],
    });
    return () => {};
  },
}));

import { App } from "../../src/app.js";

beforeEach(() => {
  installLocalStoragePolyfill();
  // Manual selection: stub /api/user-projects so App derives workspaces and activeKey.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = typeof url === "string" ? url : String(url);
      if (u.includes("/api/user-projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            paths: ["/tmp/alpha"],
            workspaces: [{ key: "208b3cad4befbe80", cwd: "/tmp/alpha", label: "alpha" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Live-first shell flow", () => {
  // The shell now lands on Overview; Sessions is one nav click away.
  const renderOnSessions = (): void => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sessions/ }));
  };

  it("shows the grouped session home (no project gate)", async () => {
    renderOnSessions();
    // Scoped to the page body: the workspace switcher in the top bar shows the
    // same label, so an unscoped query now matches twice.
    const page = within(screen.getByTestId("page-container"));
    await waitFor(() => expect(page.getByText("alpha")).toBeDefined());
    expect(page.getByText("My session")).toBeDefined();
    expect(screen.queryByText("No projects yet.")).toBeNull();
  });

  it("opens the cockpit on the transcript panel when a session is selected", async () => {
    renderOnSessions();
    await screen.findByText("My session");
    fireEvent.click(screen.getByText("My session"));
    await waitFor(() => expect(screen.getByText("transcript body")).toBeDefined());
    expect(screen.getByRole("button", { name: "Transcript" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("renders telemetry when the Telemetry tab is clicked in the cockpit", async () => {
    renderOnSessions();
    await screen.findByText("My session");
    fireEvent.click(screen.getByText("My session"));
    await screen.findByText("transcript body");
    fireEvent.click(screen.getByRole("button", { name: "Telemetry" }));
    await waitFor(() => expect(screen.getByText(/LLM context tokens/)).toBeDefined());
  });
});
