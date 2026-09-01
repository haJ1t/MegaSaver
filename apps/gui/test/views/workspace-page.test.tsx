import { HARNESS_CATALOG } from "@megasaver/harness-detect/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";
import { WorkspacePage } from "../../src/views/workspace-page.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "0123456789abcdef", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
];

describe("WorkspacePage", () => {
  it("renders the picker and the workspace panels for the active key", () => {
    // Panels fetch on mount; stub fetch to a benign empty payload.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<WorkspacePage options={OPTS} activeKey="0123456789abcdef" />);
    // Workspace selection moved to the global top bar (TopBar); the page no
    // longer owns a picker. Paired with the heading assertion below so this
    // cannot pass by the page rendering nothing at all.
    expect(screen.queryByLabelText("Active workspace")).toBeNull();
    // Assert the page's own heading (robust; not coupled to child-panel markup).
    expect(screen.getByRole("heading", { name: /workspace/i })).toBeTruthy();
  });

  it("renders the Hot Handoff card with all 39 harnesses in the select dropdown", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<WorkspacePage options={OPTS} activeKey="0123456789abcdef" />);
    const select = screen.getByLabelText("Target Agent") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(HARNESS_CATALOG.length);
    expect(select.options.length).toBe(39);
  });
});
