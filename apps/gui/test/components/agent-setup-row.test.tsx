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
    render(<AgentSetupRow agent={base} busy={false} projectSelected onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /Set up/i })).toBeDefined();
  });

  it("shows a Repair action when installed but not synced", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: false }}
        busy={false}
        projectSelected
        onAction={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Repair/i })).toBeDefined();
  });

  it("surfaces the restart hint when restartRequired", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: true, restartRequired: true }}
        busy={false}
        projectSelected
        onAction={() => {}}
      />,
    );
    expect(screen.getByText(/Restart Claude Code/i)).toBeDefined();
  });

  it("fires onAction with the right verb on click", () => {
    const onAction = vi.fn();
    render(<AgentSetupRow agent={base} busy={false} projectSelected onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /Set up/i }));
    expect(onAction).toHaveBeenCalledWith("install");
  });

  it("renders the agent id", () => {
    render(<AgentSetupRow agent={base} busy={false} projectSelected onAction={() => {}} />);
    expect(screen.getByText("claude-code")).toBeDefined();
  });

  it("disables install/repair and shows a hint when no project is selected", () => {
    render(<AgentSetupRow agent={base} busy={false} projectSelected={false} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: /Set up/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Pick a project/i)).toBeDefined();
  });

  it("does NOT gate uninstall on project selection", () => {
    render(
      <AgentSetupRow
        agent={{ ...base, mcpInstalled: true, connectorSynced: true, restartRequired: false }}
        busy={false}
        projectSelected={false}
        onAction={() => {}}
      />,
    );
    // Ready state → Uninstall, which needs no project.
    expect(screen.getByRole("button", { name: /Uninstall/i }).hasAttribute("disabled")).toBe(false);
  });
});
