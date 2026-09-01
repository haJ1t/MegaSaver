import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionTraceTab } from "../../src/views/cockpit/decision-trace-tab.js";
import { LivingBrainTab } from "../../src/views/cockpit/living-brain-tab.js";
import { MemoryUniverseTab } from "../../src/views/cockpit/memory-universe-tab.js";

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchSessionMemory: vi.fn().mockResolvedValue([
    {
      id: "mem-1",
      content: "Always use strict typing",
      scope: "project",
      type: "convention",
      validTo: null,
    },
  ]),
  fetchSessionMemoryGraph: vi.fn().mockResolvedValue({
    nodes: [{ id: "n1", kind: "project", label: "Root", meta: {} }],
    edges: [],
    stats: { nodeCount: 1, edgeCount: 0 },
  }),
  fetchBrainSyncStatus: vi.fn().mockResolvedValue({
    configured: true,
    status: "ok",
    generation: 1,
    upToDate: true,
  }),
  createSessionMemory: vi.fn(),
  deleteSessionMemory: vi.fn(),
  reopenSessionMemory: vi.fn(),
  fetchMemoryHistory: vi.fn(),
  fetchMemoryExplain: vi.fn(),
}));

describe("Memory Dedicated Tab Views", () => {
  it("renders LivingBrainTab with memory notes and composer", async () => {
    render(<LivingBrainTab dir="ws-dir" id="sess-1" />);
    expect(screen.getByText(/Create Memory Note/i)).toBeDefined();
    expect(screen.getByText(/Active Memory Notes/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/search memories/i)).toBeDefined();
  });

  it("renders DecisionTraceTab with title and description", () => {
    render(<DecisionTraceTab dir="ws-dir" id="sess-1" />);
    expect(screen.getByText(/Decision Trace Engine/i)).toBeDefined();
  });

  it("renders MemoryUniverseTab loading state", () => {
    render(<MemoryUniverseTab dir="ws-dir" id="sess-1" />);
    expect(screen.getByText(/Constructing 3D Universal Memory Cosmos/i)).toBeDefined();
  });
});
