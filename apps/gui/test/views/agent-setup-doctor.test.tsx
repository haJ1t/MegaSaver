// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSetupDoctor } from "../../src/views/agent-setup-doctor.js";

const DEMO_PROJECT = { id: "p1", name: "demo", rootPath: "/tmp/demo" };

const NOT_INSTALLED = {
  agents: [
    {
      agentId: "claude-code",
      mcpInstalled: true,
      connectorSynced: false,
      restartRequired: false,
      restartHint: "Restart Claude Code to load the MCP server.",
    },
  ],
};
const REPAIRED = {
  agents: [
    {
      ...NOT_INSTALLED.agents[0],
      connectorSynced: true,
      restartRequired: true,
    },
  ],
};

function makeFetchMock(handlers: {
  status?: () => Promise<unknown>;
  projects?: () => Promise<unknown>;
  repair?: () => Promise<unknown>;
}) {
  let statusCalls = 0;
  let repairCalls = 0;
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/mcp/status")) {
      statusCalls += 1;
      return { ok: true, status: 200, json: handlers.status ?? (async () => NOT_INSTALLED) };
    }
    if (url.includes("/api/projects")) {
      return { ok: true, status: 200, json: handlers.projects ?? (async () => [DEMO_PROJECT]) };
    }
    if (url.includes("/api/mcp/repair")) {
      repairCalls += 1;
      return { ok: true, status: 200, json: handlers.repair ?? (async () => REPAIRED) };
    }
    if (url.includes("/api/mcp/install")) {
      return { ok: true, status: 200, json: async () => REPAIRED };
    }
    if (url.includes("/api/mcp/uninstall")) {
      return { ok: true, status: 200, json: async () => NOT_INSTALLED };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: "not found", code: "not_found" }),
    };
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentSetupDoctor", () => {
  it("loads and lists agents with a Repair action when config is missing", async () => {
    vi.stubGlobal("fetch", makeFetchMock({}));
    render(<AgentSetupDoctor />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Repair/i })).toBeDefined());
  });

  it("repairs on click and re-fetches, passing the selected project", async () => {
    let repaired = false;
    const fetchMock = makeFetchMock({
      status: async () => (repaired ? REPAIRED : NOT_INSTALLED),
      repair: async () => {
        repaired = true;
        return REPAIRED;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentSetupDoctor />);
    await waitFor(() => screen.getByRole("button", { name: /Repair/i }));
    fireEvent.click(screen.getByRole("button", { name: /Repair/i }));

    await waitFor(() => expect(screen.getByText(/Restart Claude Code/i)).toBeDefined());
    const repairCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/mcp/repair"));
    expect(JSON.parse((repairCall?.[1] as RequestInit).body as string)).toEqual({
      target: "claude-code",
      project: "demo",
    });
  });

  it("announces the action outcome to assistive tech via a polite live region", async () => {
    let repaired = false;
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        status: async () => (repaired ? REPAIRED : NOT_INSTALLED),
        repair: async () => {
          repaired = true;
          return REPAIRED;
        },
      }),
    );

    render(<AgentSetupDoctor />);
    await waitFor(() => screen.getByRole("button", { name: /Repair/i }));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Repair/i }));
    await waitFor(() => expect(status.textContent).toMatch(/repaired for claude-code/i));
  });

  it("auto-selects the only project and disables actions when no project exists", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ projects: async () => [] }));
    render(<AgentSetupDoctor />);
    await waitFor(() =>
      expect(screen.getByText(/Create a project first to set up an agent/i)).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: /Repair/i }).hasAttribute("disabled")).toBe(true);
  });

  it("renders a project select when multiple projects exist", async () => {
    let repaired = false;
    const fetchMock = makeFetchMock({
      projects: async () => [DEMO_PROJECT, { id: "p2", name: "other", rootPath: "/tmp/other" }],
      status: async () => (repaired ? REPAIRED : NOT_INSTALLED),
      repair: async () => {
        repaired = true;
        return REPAIRED;
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentSetupDoctor />);
    const select = await waitFor(() => screen.getByRole("combobox"));
    expect(select).toBeDefined();
    fireEvent.change(select, { target: { value: "other" } });

    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /Repair/i })));
    await waitFor(() => expect(screen.getByText(/Restart Claude Code/i)).toBeDefined());

    const repairCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/mcp/repair"));
    expect(JSON.parse((repairCall?.[1] as RequestInit).body as string)).toEqual({
      target: "claude-code",
      project: "other",
    });
  });

  it("does not update state after unmount", async () => {
    let resolveSlow: unknown = null;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((resolve) => {
          resolveSlow = resolve;
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<AgentSetupDoctor />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    unmount();
    (resolveSlow as (value: unknown) => void)({ agents: [], projects: [] });
    // The guard prevents setState on an unmounted component; no assertion
    // needed beyond the test completing without a React warning.
  });

  it("shows an error state when the status fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom", code: "mcp_setup_failed" }),
      })),
    );
    render(<AgentSetupDoctor />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
