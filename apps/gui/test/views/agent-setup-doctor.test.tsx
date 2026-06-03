// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSetupDoctor } from "../../src/views/agent-setup-doctor.js";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentSetupDoctor", () => {
  it("loads and lists agents with a Repair action when config is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => NOT_INSTALLED })),
    );
    render(<AgentSetupDoctor activeProjectId="demo" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Repair/i })).toBeDefined());
  });

  it("repairs on click (passing the project) and re-fetches, surfacing the restart hint", async () => {
    const fetchMock = vi
      .fn()
      // initial status
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => NOT_INSTALLED })
      // POST repair (returns post-op snapshot)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => REPAIRED })
      // re-fetch status after mutation
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => REPAIRED });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentSetupDoctor activeProjectId="demo" />);
    await waitFor(() => screen.getByRole("button", { name: /Repair/i }));
    fireEvent.click(screen.getByRole("button", { name: /Repair/i }));

    await waitFor(() => expect(screen.getByText(/Restart Claude Code/i)).toBeDefined());
    // repair POST carried the active project in its body.
    const repairCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/mcp/repair"));
    expect(JSON.parse((repairCall?.[1] as RequestInit).body as string)).toEqual({
      target: "claude-code",
      project: "demo",
    });
  });

  it("disables Repair when no project is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => NOT_INSTALLED })),
    );
    render(<AgentSetupDoctor activeProjectId={null} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Repair/i }).hasAttribute("disabled")).toBe(true),
    );
    expect(screen.getByText(/Pick a project/i)).toBeDefined();
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
    render(<AgentSetupDoctor activeProjectId="demo" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
