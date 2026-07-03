// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";
import { MemoryPage } from "../../src/views/memory-page.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
];

describe("MemoryPage", () => {
  it("renders the picker and memory panel for the representative session", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<MemoryPage options={OPTS} activeKey="k1" onWorkspaceChange={() => {}} />);
    expect(screen.getByLabelText("Active workspace")).toBeTruthy();
    // Page-owned heading is the first match; MemoryPanel renders its own
    // "Memory" heading too, so scope to the page-level one specifically.
    const [pageHeading] = screen.getAllByRole("heading", { name: /memory/i });
    expect(pageHeading?.textContent).toBe("Memory");
  });

  it("prompts to select when there is no active workspace", () => {
    render(<MemoryPage options={[]} activeKey={null} onWorkspaceChange={() => {}} />);
    expect(screen.getByText(/select a workspace/i)).toBeTruthy();
  });
});
