// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";
import { MemoryPage } from "../../src/views/memory-page.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "my-project", rep: { dir: "d1", id: "s1" } },
];

describe("MemoryPage", () => {
  it("renders 3 tabs and switches active view on click", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    render(<MemoryPage options={OPTS} activeKey="k1" />);

    // 1. Initial tab: Living Brain
    expect(screen.getByRole("tab", { name: /Living Brain/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Memory Graph/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Decision Trace/i })).toBeDefined();

    // 2. Switch to Memory Graph
    fireEvent.click(screen.getByRole("tab", { name: /Memory Graph/i }));
    expect(screen.getByTestId("memory-tab-content")).toBeDefined();

    // 3. Switch to Decision Trace
    fireEvent.click(screen.getByRole("tab", { name: /Decision Trace/i }));
    expect(screen.getByText(/Decision Trace Engine/i)).toBeDefined();
  });
});
