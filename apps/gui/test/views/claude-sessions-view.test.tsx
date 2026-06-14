// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeSessionMeta, Workspace } from "../../src/lib/claude-sessions-client.js";

const fetchClaudeSessions = vi.fn();
const fetchWorkspaces = vi.fn();
const fetchClaudeSessionTelemetry = vi.fn();
const openClaudeSessionStream = vi.fn();

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: (...a: unknown[]) => fetchClaudeSessions(...a),
  fetchWorkspaces: (...a: unknown[]) => fetchWorkspaces(...a),
  fetchClaudeSessionTelemetry: (...a: unknown[]) => fetchClaudeSessionTelemetry(...a),
  openClaudeSessionStream: (...a: unknown[]) => openClaudeSessionStream(...a),
}));

const meta = (over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta => ({
  dir: "-d",
  id: "i",
  mtimeMs: 0,
  size: 0,
  title: "t",
  projectLabel: "/x",
  isArchived: false,
  model: "",
  permissionMode: "",
  lastActivityAt: 0,
  ...over,
});

const SESSIONS: ClaudeSessionMeta[] = [
  meta({ dir: "-d", id: "b", title: "Beta", projectLabel: "/Users/me/proj", mtimeMs: 300 }),
  meta({ dir: "-d", id: "a", title: "Alpha", projectLabel: "/Users/me/proj", mtimeMs: 100 }),
  meta({ dir: "-d", id: "c", title: "Gamma", projectLabel: "/Users/me/other", mtimeMs: 200 }),
];

const WORKSPACES: Workspace[] = [
  { key: "k1", label: "/Users/me/proj", sessionCount: 2, lastActivityMs: 300 },
  { key: "k2", label: "/Users/me/other", sessionCount: 1, lastActivityMs: 200 },
];

let ClaudeSessionsView: typeof import("../../src/views/claude-sessions-view.js").ClaudeSessionsView;

beforeEach(async () => {
  fetchClaudeSessions.mockResolvedValue(SESSIONS);
  fetchWorkspaces.mockResolvedValue(WORKSPACES);
  fetchClaudeSessionTelemetry.mockResolvedValue(null);
  openClaudeSessionStream.mockReturnValue(() => undefined);
  ({ ClaudeSessionsView } = await import("../../src/views/claude-sessions-view.js"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClaudeSessionsView — workspace grouping", () => {
  it("renders a group header per folder", async () => {
    render(<ClaudeSessionsView />);
    expect(await screen.findByText("proj")).toBeDefined();
    expect(screen.getByText("other")).toBeDefined();
  });

  it("orders sessions newest-first within a group", async () => {
    render(<ClaudeSessionsView />);
    await screen.findByText("Beta");
    const buttons = screen.getAllByRole("button");
    const betaIdx = buttons.findIndex((b) => b.textContent?.includes("Beta"));
    const alphaIdx = buttons.findIndex((b) => b.textContent?.includes("Alpha"));
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeLessThan(alphaIdx);
  });

  it("toggles a group's rows when its header is clicked", async () => {
    render(<ClaudeSessionsView />);
    const header = await screen.findByRole("button", { name: /proj/ });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Beta")).toBeDefined();
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.getByText("Gamma")).toBeDefined();
  });

  it("opens a stream when a session row is selected", async () => {
    render(<ClaudeSessionsView />);
    fireEvent.click(await screen.findByText("Beta"));
    await waitFor(() => expect(openClaudeSessionStream).toHaveBeenCalled());
    expect(openClaudeSessionStream.mock.calls[0]?.[1]).toBe("b");
  });
});
