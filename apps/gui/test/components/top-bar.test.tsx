// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../../src/components/top-bar.js";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";

afterEach(cleanup);

const OPTIONS: WorkspaceOption[] = [
  { key: "k1", cwd: "/tmp/alpha", label: "alpha", rep: { dir: "d1", id: "s1" } },
  { key: "k2", cwd: "/tmp/beta", label: "beta", rep: { dir: "d2", id: "s2" } },
];

function renderBar(over: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  const props = {
    options: OPTIONS,
    activeKey: "k1",
    onWorkspaceChange: vi.fn(),
    onAddProject: vi.fn(),
    onRemoveProject: vi.fn(),
    liveCount: 0,
    onOpenPalette: vi.fn(),
    ...over,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  it("shows the active workspace and its path", () => {
    renderBar();
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("/tmp/alpha")).toBeTruthy();
  });

  it("falls back to the first option when activeKey is null", () => {
    renderBar({ activeKey: null });
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("reports a workspace switch and closes the dropdown", () => {
    const { onWorkspaceChange } = renderBar();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("beta"));
    expect(onWorkspaceChange).toHaveBeenCalledWith("k2");
    // Closed again: "beta" is no longer in the list.
    expect(screen.queryByText("/tmp/beta")).toBeNull();
  });

  it("marks the active option with aria-current", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const options = screen.getAllByRole("listitem");
    expect(options.length).toBe(2);
    expect(options[0]?.querySelector("button")?.getAttribute("aria-current")).toBe("true");
    expect(options[1]?.querySelector("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("closes the dropdown on Escape", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("/tmp/beta")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("/tmp/beta")).toBeNull();
  });

  it("renders empty state when there are no workspaces", () => {
    renderBar({ options: [], activeKey: null });
    const trigger = screen.getByRole("button", { name: /Select workspace/ });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByText("No project added yet.")).toBeTruthy();
  });

  it("adds a project via native directory picker (OS dialog)", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ path: "/tmp/new-proj" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const { onAddProject } = renderBar();
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByText("+ Add project"));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(onAddProject).toHaveBeenCalledWith("/tmp/new-proj");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("does nothing when picker is cancelled (path null)", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ path: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const { onAddProject } = renderBar();
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByText("+ Add project"));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(onAddProject).not.toHaveBeenCalled();
      expect(screen.queryByText("+ Add project")).not.toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("adds a project via manual path fallback", () => {
    const { onAddProject } = renderBar();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText("or paste path manually"));
    const input = screen.getByPlaceholderText("/absolute/path/to/project") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/tmp/new-proj" } });
    fireEvent.click(screen.getByText("Add"));
    expect(onAddProject).toHaveBeenCalledWith("/tmp/new-proj");
  });

  it("removes a project via the x button", () => {
    const { onRemoveProject } = renderBar();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const removeBtn = screen.getByLabelText("Remove beta");
    fireEvent.click(removeBtn);
    expect(onRemoveProject).toHaveBeenCalledWith("/tmp/beta");
  });

  it("renders the live count and opens the palette", () => {
    const { onOpenPalette } = renderBar({ liveCount: 3 });
    expect(screen.getByText(/3 live/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Search or jump to/ }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });
});
