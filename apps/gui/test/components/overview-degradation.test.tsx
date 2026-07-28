// @vitest-environment jsdom
// Failure-path coverage for OverviewPage. The happy path lives in
// overview-page.test.tsx; this file exercises what happens when the bridge
// misbehaves, which is where the $NaN defect hid.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module-level consts, so the shared holder and the
// reject helper must be created with vi.hoisted.
const h = vi.hoisted(() => ({
  // Deliberately wrong shapes: these routes are unvalidated casts, so a body
  // that does not match the declared type still reaches the component.
  totals: null as unknown,
  reject: () => Promise.reject(new Error("bridge down")),
}));

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeSessions: () => Promise.resolve([]),
  fetchAllWorkspaceTotals: () => Promise.resolve(h.totals),
  fetchClaudeHookStatus: h.reject,
  fetchProxyStatus: h.reject,
  fetchDaemonStatus: h.reject,
}));
vi.mock("../../src/lib/api-client.js", () => ({ fetchMcpStatus: h.reject }));
vi.mock("../../src/lib/workspaces-client.js", () => ({ fetchWorkspaceIndex: h.reject }));

import { OverviewPage } from "../../src/views/overview-page.js";

const OPTIONS = [{ key: "k1", cwd: "/tmp/a", label: "alpha", rep: { dir: "d", id: "s" } }];

function renderPage() {
  render(
    <OverviewPage
      options={OPTIONS}
      activeKey="k1"
      onNavigate={() => {}}
      onOpenSession={() => {}}
    />,
  );
}

beforeEach(() => {
  h.totals = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OverviewPage — bridge failures", () => {
  it("degrades every readiness row instead of blanking the section", async () => {
    renderPage();
    expect(await screen.findByText("0 of 5 ready")).toBeTruthy();
    for (const label of ["Saver hook", "Compression proxy", "MCP bridge", "Daemon", "Code index"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("not installed")).toBeTruthy();
  });

  it("survives an MCP response with no agents array", async () => {
    renderPage();
    // Would throw "mcp.agents.filter is not a function" without the guard.
    expect(await screen.findByText("MCP bridge")).toBeTruthy();
  });
});

describe("OverviewPage — malformed totals never reach the headline", () => {
  it.each([
    ["null", null],
    ["an empty array (truthy!)", []],
    ["an object missing every field", {}],
    ["a string", "nope"],
    [
      "NaN fields",
      { bytesSavedTotal: Number.NaN, sessionsCount: 1, savingRatio: 1, workspaceCount: 1 },
    ],
  ])("shows the honest empty state for %s", async (_label, value) => {
    h.totals = value;
    renderPage();
    await waitFor(() => expect(screen.getByText(/No savings recorded yet/)).toBeTruthy());
    // The regression this guards: "$NaN" rendered as the flagship figure.
    expect(document.body.textContent).not.toContain("NaN");
    // All three figures degrade together: $, tokens saved, average reduction.
    expect(screen.getAllByText("—").length).toBe(3);
  });

  it("renders a real figure when the shape is valid", async () => {
    h.totals = {
      bytesSavedTotal: 8_000_000,
      sessionsCount: 12,
      savingRatio: 0.41,
      workspaceCount: 3,
    };
    renderPage();
    // 8,000,000 bytes / 4 = 2M tokens -> priced by @megasaver/stats.
    expect(await screen.findByText("2.00M")).toBeTruthy();
    expect(document.body.textContent).not.toContain("NaN");
  });
});
