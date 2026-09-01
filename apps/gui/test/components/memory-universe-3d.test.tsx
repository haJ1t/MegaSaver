import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MemoryGraphData } from "../../src/lib/claude-sessions-client.js";
import { MemoryUniverse3D, nodeColor } from "../../src/views/cockpit/memory-universe-3d.js";

const mockGraphData: MemoryGraphData = {
  nodes: [
    { id: "proj-1", kind: "project", label: "My Project", meta: {} },
    {
      id: "mem-1",
      kind: "memory",
      label: "Decision: Use AES-256",
      meta: { memoryType: "decision", confidence: "high" },
    },
    {
      id: "mem-2",
      kind: "memory",
      label: "Bug: Fix Token Leak",
      meta: { memoryType: "bug", confidence: "medium" },
    },
    { id: "wiki-1", kind: "wiki", label: "Architecture Overview", meta: {} },
  ],
  edges: [
    { id: "e1", kind: "cites", from: "mem-1", to: "proj-1" },
    { id: "e2", kind: "cites", from: "mem-2", to: "proj-1" },
  ],
  stats: { nodeCount: 4, edgeCount: 2 },
};

describe("MemoryUniverse3D Component", () => {
  it("renders 3D universe HUD controls and statistics", () => {
    render(<MemoryUniverse3D data={mockGraphData} />);

    expect(screen.getByPlaceholderText(/search celestial memory nodes/i)).toBeDefined();
    expect(screen.getByText(/3D Universe System/i)).toBeDefined();
    expect(screen.getByText("Decisions", { exact: false })).toBeDefined();
    expect(screen.getByText("Architecture", { exact: false })).toBeDefined();
    expect(screen.getByText("Bugs", { exact: false })).toBeDefined();
    expect(screen.getByText("Wiki", { exact: false })).toBeDefined();
  });

  it("computes accurate color codes for memory node categories", () => {
    expect(nodeColor({ id: "1", kind: "project", label: "P", meta: {} })).toBe("#7C3AED");
    expect(
      nodeColor({
        id: "2",
        kind: "memory",
        label: "M",
        meta: { memoryType: "decision" },
      }),
    ).toBe("#0EA5E9");
    expect(
      nodeColor({
        id: "3",
        kind: "memory",
        label: "M",
        meta: { memoryType: "bug" },
      }),
    ).toBe("#DC2626");
    expect(nodeColor({ id: "4", kind: "wiki", label: "W", meta: {} })).toBe("#9333EA");
  });
});
