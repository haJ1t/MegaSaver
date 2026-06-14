// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSetupRow } from "../../src/components/agent-setup-row.js";
import type { McpAgentStatus } from "../../src/lib/api-client.js";

const base: McpAgentStatus = {
  agentId: "claude-code",
  mcpInstalled: false,
  connectorSynced: false,
  restartRequired: false,
  restartHint: "Restart Claude Code to load the Mega Saver MCP server.",
};

afterEach(cleanup);

describe("AgentSetupRow", () => {
  it("shows a Set up action when not installed", () => {
    render(<AgentSetupRow agent={base} busy={false} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /Set up/i })).toBeDefined();
  });

  it("shows a Repair action when installed but not synced", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: false }}
        busy={false}
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Repair/i })).toBeDefined();
  });

  it("ready agent (live backend sets restartRequired=true) keeps Uninstall reachable + shows the restart hint", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: true, restartRequired: true }}
        busy={false}
        onAction={() => {}}
      />,
    );
    // Regression guard: the backend sets restartRequired = mcpInstalled, so every
    // ready agent has restartRequired:true. It must surface as an ADDITIVE notice,
    // never an action-suppressing dead state — Ready + Uninstall stay reachable.
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByRole("button", { name: /Uninstall/i })).toBeDefined();
    expect(screen.getByText(/Restart Claude Code/i)).toBeDefined();
  });

  it("fires onAction with the right verb on click", () => {
    const onAction = vi.fn();
    render(<AgentSetupRow agent={base} busy={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /Set up/i }));
    expect(onAction).toHaveBeenCalledWith("install");
  });

  it("renders the agent id", () => {
    render(<AgentSetupRow agent={base} busy={false} onAction={() => {}} />);
    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("install/repair are enabled with no project notice (project-free shell)", () => {
    render(<AgentSetupRow agent={base} busy={false} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /Set up/i }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Pick a project/i)).toBeNull();
  });

  it("uninstall stays enabled", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: true, restartRequired: false }}
        busy={false}
        onAction={() => {}}
      />,
    );
    // Ready state → Uninstall.
    expect(screen.getByRole("button", { name: /Uninstall/i }).hasAttribute("disabled")).toBe(false);
  });
});
