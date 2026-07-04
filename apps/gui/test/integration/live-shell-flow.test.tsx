// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: () => Promise.resolve([SESSION]),
  fetchClaudeSessionTelemetry: () => Promise.resolve(TELEMETRY),
  fetchSessionTokenSaverStats: () => Promise.resolve(null),
  fetchWorkspaceTokenSaverStats: () => Promise.resolve(null),
  fetchDaemonStatus: () => Promise.resolve({ running: true }),
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
  // Legacy path projects fetch: no projects.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Live-first shell flow", () => {
  it("shows the grouped session home (no project gate)", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    expect(screen.getByText("My session")).toBeDefined();
    expect(screen.queryByText("No projects yet.")).toBeNull();
  });

  it("opens the cockpit on the transcript panel when a session is selected", async () => {
    render(<App />);
    await screen.findByText("My session");
    fireEvent.click(screen.getByText("My session"));
    await waitFor(() => expect(screen.getByText("transcript body")).toBeDefined());
    expect(screen.getByRole("button", { name: "Transcript" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("renders telemetry when the Telemetry tab is clicked in the cockpit", async () => {
    render(<App />);
    await screen.findByText("My session");
    fireEvent.click(screen.getByText("My session"));
    await screen.findByText("transcript body");
    fireEvent.click(screen.getByRole("button", { name: "Telemetry" }));
    await waitFor(() => expect(screen.getByText(/LLM context tokens/)).toBeDefined());
  });
});
