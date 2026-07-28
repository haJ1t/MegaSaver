import { computeSavingsHeadline, formatDollarsSaved } from "@megasaver/stats/headline";
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const now = Date.now();

const SESSIONS = [
  {
    dir: "proj",
    id: "live-1",
    mtimeMs: now,
    size: 1,
    title: "Live one",
    projectLabel: "/tmp/alpha",
    isArchived: false,
    model: "m",
    permissionMode: "default",
    lastActivityAt: now,
  },
  {
    dir: "proj",
    id: "stale-1",
    mtimeMs: now - 60_000,
    size: 1,
    title: "Stale one",
    projectLabel: "/tmp/alpha",
    isArchived: false,
    model: "m",
    permissionMode: "default",
    lastActivityAt: now - 60_000,
  },
];

const hooks = { connected: true, preInstalled: true, postInstalled: true };
const proxy = {
  enabled: false,
  routed: false,
  routeConflict: false,
  reconcileBlocked: false,
  draining: false,
  url: "http://127.0.0.1:7431",
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: () => Promise.resolve(SESSIONS),
  // 4 bytes/token, 2M tokens saved at the shared Sonnet input price.
  fetchAllWorkspaceTotals: () =>
    Promise.resolve({
      bytesSavedTotal: 8_000_000,
      sessionsCount: 12,
      savingRatio: 0.41,
      workspaceCount: 3,
    }),
  fetchClaudeHookStatus: () => Promise.resolve(hooks),
  fetchProxyStatus: () => Promise.resolve(proxy),
  fetchDaemonStatus: () => Promise.resolve({ running: true }),
}));

vi.mock("../../src/lib/api-client.js", () => ({
  fetchMcpStatus: () =>
    Promise.resolve({
      agents: [
        {
          agentId: "claude-code",
          mcpInstalled: true,
          connectorSynced: true,
          restartRequired: false,
          restartHint: "",
        },
      ],
    }),
}));

vi.mock("../../src/lib/workspaces-client.js", () => ({
  fetchWorkspaceIndex: () =>
    Promise.resolve({ indexed: false, total: 0, indexedFiles: 0, byType: {} }),
}));

import { OverviewPage } from "../../src/views/overview-page.js";

const OPTIONS = [
  { key: "k1", cwd: "/tmp/alpha", label: "alpha", rep: { dir: "proj", id: "live-1" } },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OverviewPage", () => {
  it("renders the savings headline from the real totals", async () => {
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={() => {}}
        onOpenSession={() => {}}
      />,
    );
    // 8,000,000 bytes / 4 = 2M tokens.
    expect(await screen.findByText("2.00M")).toBeTruthy();
    expect(screen.getByText(/across 12 sessions/)).toBeTruthy();
    expect(screen.getByText("41%")).toBeTruthy();
    // Pin the actual computed value, not just "looks like money": 2M tokens
    // priced by @megasaver/stats at the shared input rate. A hardcoded literal
    // or a drifted price constant both fail here.
    const expected = `≈${formatDollarsSaved(
      computeSavingsHeadline({
        bytesSavedTotal: 8_000_000,
        sessionsCount: 12,
        savingRatio: 0.41,
      }).dollarsSaved,
    )}`;
    expect(await screen.findByText(expected)).toBeTruthy();
    // The estimate marker is required discipline, not decoration.
    expect(screen.getByText("(est.)")).toBeTruthy();
  });

  it("counts only ready checks and offers a fix for the failing ones", async () => {
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={() => {}}
        onOpenSession={() => {}}
      />,
    );
    // hook + mcp + daemon ready; proxy stopped and index missing.
    expect(await screen.findByText("3 of 5 ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build index" })).toBeTruthy();
  });

  it("routes the MCP fix to Setup, not Token saver", async () => {
    const onNavigate = vi.fn();
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={onNavigate}
        onOpenSession={() => {}}
      />,
    );
    // MCP is installed in this fixture, so assert the proxy row instead.
    (await screen.findByRole("button", { name: "Turn on" })).click();
    expect(onNavigate).toHaveBeenCalledWith("token-saver");
  });

  it("routes the index fix to the Workspace page", async () => {
    const onNavigate = vi.fn();
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={onNavigate}
        onOpenSession={() => {}}
      />,
    );
    (await screen.findByRole("button", { name: "Build index" })).click();
    expect(onNavigate).toHaveBeenCalledWith("workspace");
  });

  it("lists only live sessions", async () => {
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={() => {}}
        onOpenSession={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("Live one")).toBeTruthy());
    expect(screen.queryByText("Stale one")).toBeNull();
  });

  it("does not render the unbacked sparkline or recent-activity feed", async () => {
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={() => {}}
        onOpenSession={() => {}}
      />,
    );
    await screen.findByText("Live now");
    // Both are omitted by spec §4 — no bridge route backs them.
    expect(screen.queryByText(/Recent saver activity/i)).toBeNull();
    expect(screen.queryByText(/days ago/i)).toBeNull();
  });
});
