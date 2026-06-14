// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTelemetry, StreamHandlers } from "../../src/lib/claude-sessions-client.js";

const TELEMETRY: SessionTelemetry = {
  turnCount: 3,
  assistantTurns: 1,
  toolCallCount: 0,
  totals: {
    inputTokens: 10,
    outputTokens: 20,
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
  openClaudeSessionStream: (_dir: string, _id: string, handlers: StreamHandlers) => {
    handlers.onSnapshot({ projectLabel: "/tmp/w", messages: [] });
    return () => {};
  },
  fetchClaudeSessionTelemetry: () => Promise.resolve(TELEMETRY),
}));

import { SessionCockpit } from "../../src/cockpit/session-cockpit.js";

afterEach(() => {
  cleanup();
});

describe("SessionCockpit", () => {
  it("renders one tab per registered panel with Transcript active by default", () => {
    render(<SessionCockpit dir="d" id="i" cwd="/tmp/w" title="Demo" onBack={() => {}} />);
    const transcriptTab = screen.getByRole("button", { name: "Transcript" });
    const telemetryTab = screen.getByRole("button", { name: "Telemetry" });
    expect(transcriptTab).toBeDefined();
    expect(telemetryTab).toBeDefined();
    expect(transcriptTab.getAttribute("aria-current")).toBe("page");
    expect(telemetryTab.getAttribute("aria-current")).toBeNull();
  });

  it("switches active panel and renders telemetry when the Telemetry tab is clicked", async () => {
    render(<SessionCockpit dir="d" id="i" cwd="/tmp/w" title="Demo" onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Telemetry" }));
    expect(screen.getByRole("button", { name: "Telemetry" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Transcript" }).getAttribute("aria-current"),
    ).toBeNull();
    await waitFor(() => expect(screen.getByText(/LLM context tokens/)).toBeDefined());
  });

  it("invokes onBack when the Back control is clicked", () => {
    const onBack = vi.fn();
    render(<SessionCockpit dir="d" id="i" cwd="/tmp/w" title="Demo" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("mounts the workspace Rules panel keyed by the session cwd", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
    );
    render(<SessionCockpit dir="d" id="i" cwd="/tmp/w" title="Demo" onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText("No rules yet.")).toBeDefined());
    vi.unstubAllGlobals();
  });
});
