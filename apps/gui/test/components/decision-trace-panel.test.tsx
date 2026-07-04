// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionTraceData } from "../../src/lib/decision-trace-client.js";

const stub: { fetch: (dir: string, id: string) => Promise<DecisionTraceData> } = {
  fetch: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/decision-trace-client.js", () => ({
  fetchDecisionTraceGraph: (dir: string, id: string) => stub.fetch(dir, id),
}));

let capturedElements: Array<{ data?: { id?: string; color?: string }; classes?: string }> = [];
let capturedResize = vi.fn();
let capturedFit = vi.fn();

vi.mock("cytoscape", () => ({
  default: (opts: {
    elements?: Array<{ data?: { id?: string; color?: string }; classes?: string }>;
  }) => {
    capturedElements = opts.elements ?? [];
    capturedResize = vi.fn();
    capturedFit = vi.fn();
    return {
      on: () => undefined,
      layout: () => ({ run: () => undefined }),
      resize: capturedResize,
      fit: capturedFit,
      destroy: () => undefined,
    };
  },
}));

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

import { DecisionTracePanel } from "../../src/views/cockpit/decision-trace-panel.js";

const MEM_A = "mem-abc";

const FIXTURE: DecisionTraceData = {
  nodes: [
    { id: "output:0", kind: "output", label: "Read → compressed", meta: {} },
    { id: "chunk:0:0", kind: "chunk", label: "lines 1-10", meta: { score: 0.9 } },
    { id: MEM_A, kind: "memory", label: MEM_A, meta: {} },
    { id: "redaction:0", kind: "redaction", label: "2 high-risk", meta: {} },
  ],
  edges: [
    { source: "output:0", target: "chunk:0:0", kind: "ranked" },
    { source: MEM_A, target: "output:0", kind: "pinned" },
    { source: "output:0", target: "redaction:0", kind: "redacted" },
  ],
  stats: { outputs: 1, chunks: 1, memoriesPinned: 1 },
};

const EMPTY: DecisionTraceData = {
  nodes: [],
  edges: [],
  stats: { outputs: 0, chunks: 0, memoriesPinned: 0 },
};

async function waitForGraph(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("decision-trace-canvas")).toBeDefined();
    expect(capturedElements.length).toBeGreaterThan(0);
  });
}

afterEach(() => {
  cleanup();
  capturedElements = [];
  stub.fetch = () => Promise.reject(new Error("not set"));
});

describe("DecisionTracePanel", () => {
  it("shows the loading state then mounts the graph canvas", async () => {
    let resolve: (data: DecisionTraceData) => void = () => undefined;
    stub.fetch = () =>
      new Promise<DecisionTraceData>((r) => {
        resolve = r;
      });
    render(<DecisionTracePanel dir="d" id="i" />);
    expect(screen.getByLabelText(/Loading decision trace/i)).toBeDefined();
    resolve(FIXTURE);
    await waitForGraph();
  });

  it("passes output, chunk, memory, redaction node classes and edge classes to cytoscape", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();

    const classes = capturedElements.map((el) => el.classes);
    expect(classes).toContain("output");
    expect(classes).toContain("chunk");
    expect(classes).toContain("memory");
    expect(classes).toContain("redaction");
    expect(classes).toContain("ranked");
    expect(classes).toContain("pinned");
    expect(classes).toContain("redacted");
  });

  it("paints each node kind a distinct color", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();

    const colorFor = (id: string) => capturedElements.find((el) => el.data?.id === id)?.data?.color;
    const colors = new Set(
      ["output:0", "chunk:0:0", MEM_A, "redaction:0"].map((id) => colorFor(id)),
    );
    // Four distinct kinds → four distinct colors, none undefined.
    expect(colors.has(undefined)).toBe(false);
    expect(colors.size).toBe(4);
  });

  it("renders the honest empty-state copy for a zero-output trace", async () => {
    stub.fetch = () => Promise.resolve(EMPTY);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitFor(() =>
      expect(
        screen.getByText(
          /No decision traces for this session yet — tracing is on by default; set MEGASAVER_SEAM_TRACE=false to disable\./,
        ),
      ).toBeDefined(),
    );
  });

  it("renders an error state when the fetch fails", async () => {
    stub.fetch = () => Promise.reject({ error: "boom", code: "internal_error" });
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });

  it("re-fits cytoscape to the container box on first paint", async () => {
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();
    await waitFor(() => {
      expect(capturedResize).toHaveBeenCalled();
      expect(capturedFit).toHaveBeenCalled();
    });
  });
});
