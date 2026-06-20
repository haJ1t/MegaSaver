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
// touching the real rendering pipeline. Captures the elements array so tests can
// assert that the correct cytoscape elements (by class) are passed.
const tapHandlers: Array<(evt: { target: { id: () => string } }) => void> = [];
let capturedElements: Array<{ classes?: string }> = [];

vi.mock("cytoscape", () => ({
  default: (opts: { elements?: Array<{ classes?: string }> }) => {
    capturedElements = opts.elements ?? [];
    return {
      on: (
        _event: string,
        _selector: string,
        handler: (evt: { target: { id: () => string } }) => void,
      ) => {
        tapHandlers.push(handler);
      },
      layout: () => ({ run: () => undefined }),
      destroy: () => undefined,
    };
  },
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

const FIXTURE_PHASE2: MemoryGraphData = {
  nodes: [
    { id: "m1", kind: "memory", label: "decided to use cose", meta: { memoryType: "decision" } },
    { id: "e1", kind: "evidence", label: "test run", meta: { status: "verified" } },
    { id: "f1", kind: "file", label: "src/lib/core.ts", meta: { path: "src/lib/core.ts" } },
    { id: "s1", kind: "symbol", label: "buildGraph", meta: { path: "src/lib/core.ts" } },
    {
      id: "w1",
      kind: "wiki",
      label: "Memory Graph design",
      meta: { title: "Memory Graph design", tags: "design,graph", status: "active" },
    },
  ],
  edges: [
    { id: "edge1", kind: "cites", from: "m1", to: "e1" },
    { id: "edge2", kind: "code-link", from: "m1", to: "f1" },
    { id: "edge3", kind: "wiki-link", from: "w1", to: "m1" },
    { id: "edge4", kind: "wiki-cite", from: "w1", to: "f1" },
    { id: "edge5", kind: "wiki-source", from: "w1", to: "e1" },
  ],
  stats: { nodeCount: 5, edgeCount: 5 },
};

const EMPTY: MemoryGraphData = {
  nodes: [],
  edges: [],
  stats: { nodeCount: 0, edgeCount: 0 },
};

afterEach(() => {
  cleanup();
  tapHandlers.length = 0;
  capturedElements = [];
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

  it("passes file, symbol, and wiki nodes with correct classes to cytoscape", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    const nodeClasses = capturedElements.map((el) => el.classes);
    expect(nodeClasses).toContain("file");
    expect(nodeClasses).toContain("symbol");
    expect(nodeClasses).toContain("wiki");
    expect(nodeClasses).toContain("code-link");
    expect(nodeClasses).toContain("wiki-link");
    expect(nodeClasses).toContain("wiki-cite");
    expect(nodeClasses).toContain("wiki-source");
  });

  it("renders Wiki and Code layer toggle buttons", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    expect(screen.getByRole("button", { name: /Wiki/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Code/i })).toBeDefined();
  });

  it("toggling Wiki off removes wiki nodes and their incident edges from cytoscape elements", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    // All wiki-kind elements present before toggle
    const beforeClasses = capturedElements.map((el) => el.classes);
    expect(beforeClasses).toContain("wiki");
    expect(beforeClasses).toContain("wiki-link");
    expect(beforeClasses).toContain("wiki-source");

    fireEvent.click(screen.getByRole("button", { name: /Wiki/i }));

    await waitFor(() => {
      const afterClasses = capturedElements.map((el) => el.classes);
      expect(afterClasses).not.toContain("wiki");
      expect(afterClasses).not.toContain("wiki-link");
      expect(afterClasses).not.toContain("wiki-source");
      // wiki-cite also drops because it's a wiki-incident edge
      expect(afterClasses).not.toContain("wiki-cite");
    });
  });

  it("toggling Code off removes file/symbol nodes, code-link edges, and the wiki-cite bridge", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    // The wiki-cite edge (w1 -> f1) bridges to a file node before the toggle.
    const beforeClasses = capturedElements.map((el) => el.classes);
    expect(beforeClasses).toContain("file");
    expect(beforeClasses).toContain("wiki-cite");

    fireEvent.click(screen.getByRole("button", { name: /Code/i }));

    await waitFor(() => {
      const afterClasses = capturedElements.map((el) => el.classes);
      expect(afterClasses).not.toContain("file");
      expect(afterClasses).not.toContain("symbol");
      expect(afterClasses).not.toContain("code-link");
      // wiki-cite points at the now-hidden file node, so the endpoint check drops it.
      expect(afterClasses).not.toContain("wiki-cite");
    });
  });

  it("updates the header counts to the visible graph after toggling Wiki off", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    expect(screen.getByText(/5 nodes/)).toBeDefined();
    expect(screen.getByText(/5 edges/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Wiki/i }));

    await waitFor(() => expect(screen.getByText(/4 nodes/)).toBeDefined());
    expect(screen.getByText(/2 edges/)).toBeDefined();
  });

  it("shows wiki node detail with title, tags, status when tapped", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    const handler = tapHandlers[0];
    if (handler) handler({ target: { id: () => "w1" } });

    // "Memory Graph design" appears in both the label <p> and the meta title <dd>
    await waitFor(() =>
      expect(screen.getAllByText("Memory Graph design").length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/design,graph/)).toBeDefined();
    expect(screen.getByText(/active/)).toBeDefined();
  });

  it("shows file node detail with path when tapped", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    const handler = tapHandlers[0];
    if (handler) handler({ target: { id: () => "f1" } });

    // "src/lib/core.ts" appears in both the label <p> and the meta path <dd>
    await waitFor(() => expect(screen.getAllByText("src/lib/core.ts").length).toBeGreaterThan(0));
    expect(screen.getByText(/path/)).toBeDefined();
  });

  it("clears the detail panel when the selected wiki node's layer is toggled off", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    const handler = tapHandlers[0];
    if (handler) handler({ target: { id: () => "w1" } });

    await waitFor(() => expect(screen.getByText(/design,graph/)).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /Wiki/i }));

    await waitFor(() => expect(screen.getByText(/Select a node to inspect/)).toBeDefined());
    expect(screen.queryByText(/design,graph/)).toBeNull();
  });

  it("clears the detail panel when the selected file node's layer is toggled off", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    const handler = tapHandlers[0];
    if (handler) handler({ target: { id: () => "f1" } });

    await waitFor(() => expect(screen.getAllByText("src/lib/core.ts").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: /Code/i }));

    await waitFor(() => expect(screen.getByText(/Select a node to inspect/)).toBeDefined());
    expect(screen.queryByText("src/lib/core.ts")).toBeNull();
  });

  it("keeps the detail panel for a still-visible node after an unrelated layer toggles off", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE_PHASE2);
    render(<MemoryGraphPanel dir="d" id="i" cwd="/tmp/w" />);
    await waitFor(() => expect(screen.getByTestId("memory-graph-canvas")).toBeDefined());

    const handler = tapHandlers[0];
    if (handler) handler({ target: { id: () => "m1" } });

    await waitFor(() => expect(screen.getByText("decided to use cose")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: /Wiki/i }));

    await waitFor(() => {
      const afterClasses = capturedElements.map((el) => el.classes);
      expect(afterClasses).not.toContain("wiki");
    });
    expect(screen.getByText("decided to use cose")).toBeDefined();
  });
});
