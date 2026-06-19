// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryGraphData } from "../../src/lib/claude-sessions-client.js";

const stub: { fetch: (dir: string, id: string) => Promise<MemoryGraphData> } = {
  fetch: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchSessionMemoryGraph: (dir: string, id: string) => stub.fetch(dir, id),
}));

// jsdom has no canvas/layout engine; stub cytoscape so the panel mounts without
// touching the real rendering pipeline. The test asserts the React shell, not
// cytoscape's internal draw.
const tapHandlers: Array<(evt: { target: { id: () => string } }) => void> = [];
vi.mock("cytoscape", () => ({
  default: () => ({
    on: (
      _event: string,
      _selector: string,
      handler: (evt: { target: { id: () => string } }) => void,
    ) => {
      tapHandlers.push(handler);
    },
    layout: () => ({ run: () => undefined }),
    destroy: () => undefined,
  }),
}));

import { MemoryGraphPanel } from "../../src/views/cockpit/memory-graph-panel.js";

const FIXTURE: MemoryGraphData = {
  nodes: [
    { id: "m1", kind: "memory", label: "decided to use cose", meta: { memoryType: "decision" } },
    { id: "e1", kind: "evidence", label: "test run", meta: { status: "verified" } },
  ],
  edges: [{ id: "edge1", kind: "cites", from: "m1", to: "e1" }],
  stats: { nodeCount: 2, edgeCount: 1 },
};

const EMPTY: MemoryGraphData = {
  nodes: [],
  edges: [],
  stats: { nodeCount: 0, edgeCount: 0 },
};

afterEach(() => {
  cleanup();
  tapHandlers.length = 0;
  stub.fetch = () => Promise.reject(new Error("not set"));
});

describe("MemoryGraphPanel", () => {
  it("shows the loading state then the graph canvas and stats", async () => {
    let resolve: (data: MemoryGraphData) => void = () => undefined;
    stub.fetch = () =>
      new Promise<MemoryGraphData>((r) => {
        resolve = r;
      });

    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);

    expect(screen.getByLabelText(/Loading memory graph/)).toBeDefined();

    resolve(FIXTURE);

    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());
    expect(screen.getByText(/2 nodes/)).toBeDefined();
    expect(screen.getByText(/1 edge/)).toBeDefined();
  });

  it("renders a node detail panel when a node is tapped", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    expect(tapHandlers.length).toBeGreaterThan(0);
    const handler = tapHandlers[0];
    if (handler) handler({ target: { id: () => "m1" } });

    await waitFor(() => expect(screen.getByText("decided to use cose")).toBeDefined());
    expect(screen.getByText(/decision/)).toBeDefined();
  });

  it("renders an empty-state message for a zero-node graph", async () => {
    stub.fetch = () => Promise.resolve(EMPTY);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByText(/No graph yet/)).toBeDefined());
  });

  it("renders an error state when the fetch fails", async () => {
    stub.fetch = () => Promise.reject({ error: "boom", code: "internal_error" });
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
