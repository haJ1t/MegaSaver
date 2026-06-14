// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContextPanel } from "../../src/views/cockpit/workspace-context-panel.js";
import { WorkspaceIndexPanel } from "../../src/views/cockpit/workspace-index-panel.js";
import { WorkspacePermissionsPanel } from "../../src/views/cockpit/workspace-permissions-panel.js";
import { WorkspaceRulesPanel } from "../../src/views/cockpit/workspace-rules-panel.js";
import { WorkspaceToolsPanel } from "../../src/views/cockpit/workspace-tools-panel.js";

const KEY = "0123456789abcdef";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubJson(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => body })),
  );
}

describe("WorkspaceIndexPanel", () => {
  it("renders byType when indexed", async () => {
    stubJson({ indexed: true, total: 2, indexedFiles: 1, byType: { function: 1, docs: 1 } });
    render(<WorkspaceIndexPanel workspaceKey={KEY} />);
    await waitFor(() => expect(screen.getByText(/function: 1/)).toBeDefined());
  });

  it("renders an error state on failure", async () => {
    stubJson({ error: "boom", code: "index_unavailable" }, false, 500);
    render(<WorkspaceIndexPanel workspaceKey={KEY} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});

describe("WorkspaceRulesPanel", () => {
  it("renders a ranked rule title", async () => {
    stubJson([
      { rule: { title: "no any", rule: "avoid any", severity: "warning" }, score: 1, reason: "x" },
    ]);
    render(<WorkspaceRulesPanel workspaceKey={KEY} />);
    await waitFor(() => expect(screen.getByText("no any")).toBeDefined());
  });

  it("renders an empty state", async () => {
    stubJson([]);
    render(<WorkspaceRulesPanel workspaceKey={KEY} />);
    await waitFor(() => expect(screen.getByText("No rules yet.")).toBeDefined());
  });
});

describe("WorkspaceToolsPanel", () => {
  it("renders the route reason", async () => {
    stubJson({
      route: { allowedTools: [], blockedTools: [], reason: "no task filter" },
      tools: [{ id: "t1", name: "git status", description: "d", category: "git", risk: "safe" }],
    });
    render(<WorkspaceToolsPanel workspaceKey={KEY} />);
    await waitFor(() => expect(screen.getByText("no task filter")).toBeDefined());
  });
});

describe("WorkspacePermissionsPanel", () => {
  it("reflects loaded:false", async () => {
    stubJson({ loaded: false });
    render(<WorkspacePermissionsPanel workspaceKey={KEY} />);
    await waitFor(() => expect(screen.getByText(/No project permissions file/)).toBeDefined());
  });
});

describe("WorkspaceContextPanel", () => {
  it("shows pack info after submitting a task", async () => {
    stubJson({ indexed: true, pack: { blocks: [{ filePath: "a.ts" }] }, audit: {} });
    render(<WorkspaceContextPanel workspaceKey={KEY} />);
    fireEvent.change(screen.getByLabelText("Context task"), { target: { value: "do x" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText(/Pack built/)).toBeDefined());
  });
});
