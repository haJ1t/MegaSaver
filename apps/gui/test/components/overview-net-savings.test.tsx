// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const now = Date.now();

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
  fetchClaudeSessions: () => Promise.resolve([]),
  // S4-1 fixture: 8M gross bytes saved, signed net 4M — expansions re-fetched
  // half of it. Net: 1M tokens -> $3.00. Gross would price $6.00.
  fetchAllWorkspaceTotals: () =>
    Promise.resolve({
      bytesSavedTotal: 8_000_000,
      deltaBytesTotal: 4_000_000,
      sessionsCount: 12,
      savingRatio: 0.41,
      workspaceCount: 3,
    }),
  fetchClaudeHookStatus: () => Promise.resolve(hooks),
  fetchProxyStatus: () => Promise.resolve(proxy),
  fetchDaemonStatus: () => Promise.resolve({ running: true }),
}));

vi.mock("../../src/lib/api-client.js", () => ({
  fetchMcpStatus: () => Promise.resolve({ agents: [] }),
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

describe("OverviewPage — net savings headline (S4-1)", () => {
  it("prices the signed net, not the gross, and shows the re-fetch breakdown", async () => {
    render(
      <OverviewPage
        options={OPTIONS}
        activeKey="k1"
        onNavigate={() => {}}
        onOpenSession={() => {}}
      />,
    );
    // Net 4M bytes -> 1M tokens -> $3.00; gross would be $6.00.
    expect(await screen.findByText("≈$3.00")).toBeTruthy();
    expect(screen.queryByText("≈$6.00")).toBeNull();
    // The tokens card carries the NET count.
    expect(screen.getByText("1.00M")).toBeTruthy();
    expect(screen.queryByText("2.00M")).toBeNull();
    // Gross stays visible as the secondary breakdown.
    expect(screen.getByText(/2\.00M.*saved.*1\.00M.*re-fetched.*1\.00M.*net/)).toBeTruthy();
    expect(screen.getByText(/across 12 sessions/)).toBeTruthy();
  });
});
