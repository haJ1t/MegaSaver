// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DecisionTraceData,
  DecisionTraceSessionSummary,
} from "../../src/lib/decision-trace-client.js";

const SESS_NEW = "sess-new";
const SESS_OLD = "sess-old";

const stub: {
  fetch: (dir: string, id: string, sessionId?: string) => Promise<DecisionTraceData>;
  sessions: (dir: string, id: string) => Promise<{ sessions: DecisionTraceSessionSummary[] }>;
} = {
  fetch: () => Promise.reject(new Error("not set")),
  sessions: () => Promise.resolve({ sessions: [] }),
};

const graphCalls: (string | undefined)[] = [];

vi.mock("../../src/lib/decision-trace-client.js", () => ({
  fetchDecisionTraceGraph: (dir: string, id: string, sessionId?: string) => {
    graphCalls.push(sessionId);
    return stub.fetch(dir, id, sessionId);
  },
  fetchDecisionTraceSessions: (dir: string, id: string) => stub.sessions(dir, id),
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

async function waitForGraph(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("decision-trace-canvas")).toBeDefined();
    expect(capturedElements.length).toBeGreaterThan(0);
  });
}

// A single-session list so the panel auto-selects it and fetches its graph. The
// picker/auto-select behavior is exercised on its own further below.
const ONE_SESSION: DecisionTraceSessionSummary[] = [
  { sessionId: SESS_NEW, outputs: 1, latestCreatedAt: "2026-07-04T01:00:00.000Z" },
];

afterEach(() => {
  cleanup();
  capturedElements = [];
  graphCalls.length = 0;
  stub.fetch = () => Promise.reject(new Error("not set"));
  stub.sessions = () => Promise.resolve({ sessions: [] });
});

describe("DecisionTracePanel", () => {
  it("shows the loading state then mounts the graph canvas", async () => {
    stub.sessions = () => Promise.resolve({ sessions: ONE_SESSION });
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    // Session + graph fetches are both async, so the first paint is the loader.
    expect(screen.getByLabelText(/Loading decision trace/i)).toBeDefined();
    await waitForGraph();
  });

  it("passes output, chunk, memory, redaction node classes and edge classes to cytoscape", async () => {
    stub.sessions = () => Promise.resolve({ sessions: ONE_SESSION });
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
    stub.sessions = () => Promise.resolve({ sessions: ONE_SESSION });
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

  it("renders the honest empty-state copy when no registry sessions exist", async () => {
    // Empty session list — the picker has nothing to select → honest empty state.
    stub.sessions = () => Promise.resolve({ sessions: [] });
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitFor(() =>
      expect(
        screen.getByText(
          /No decision traces for this session yet — tracing is on by default; set MEGASAVER_SEAM_TRACE=false to disable\./,
        ),
      ).toBeDefined(),
    );
    // And the note that traces come from proxy/registry sessions for this workspace.
    expect(screen.getByText(/proxy\/registry sessions/i)).toBeDefined();
  });

  it("renders an error state when the session fetch fails", async () => {
    stub.sessions = () => Promise.reject({ error: "boom", code: "internal_error" });
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });

  it("re-fits cytoscape to the container box on first paint", async () => {
    stub.sessions = () => Promise.resolve({ sessions: ONE_SESSION });
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();
    await waitFor(() => {
      expect(capturedResize).toHaveBeenCalled();
      expect(capturedFit).toHaveBeenCalled();
    });
  });

  it("auto-selects the newest session and fetches its graph by sessionId", async () => {
    const sessions: DecisionTraceSessionSummary[] = [
      { sessionId: SESS_NEW, outputs: 2, latestCreatedAt: "2026-07-04T02:00:00.000Z" },
      { sessionId: SESS_OLD, outputs: 1, latestCreatedAt: "2026-07-04T01:00:00.000Z" },
    ];
    stub.sessions = () => Promise.resolve({ sessions });
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();
    // Newest (first, already sorted server-side) is auto-selected for the fetch.
    expect(graphCalls).toContain(SESS_NEW);
    expect(graphCalls).not.toContain(SESS_OLD);
  });

  it("labels the memory stat 'ranked', not the retention word 'pinned'", async () => {
    stub.sessions = () => Promise.resolve({ sessions: ONE_SESSION });
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();
    // Header stat is ranking-causal: "1 ranked", never the ledger word "pinned".
    expect(screen.getByText(/\branked\b/)).toBeDefined();
    expect(screen.queryByText(/\bpinned\b/)).toBeNull();
  });

  it("renders a picker listing every registry session with its output count", async () => {
    const sessions: DecisionTraceSessionSummary[] = [
      { sessionId: SESS_NEW, outputs: 2, latestCreatedAt: "2026-07-04T02:00:00.000Z" },
      { sessionId: SESS_OLD, outputs: 1, latestCreatedAt: "2026-07-04T01:00:00.000Z" },
    ];
    stub.sessions = () => Promise.resolve({ sessions });
    stub.fetch = () => Promise.resolve(FIXTURE);
    render(<DecisionTracePanel dir="d" id="i" />);
    await waitForGraph();
    const picker = screen.getByLabelText(/trace session/i) as HTMLSelectElement;
    expect(picker.querySelectorAll("option").length).toBe(2);
    expect(screen.getByRole("option", { name: new RegExp(SESS_OLD) })).toBeDefined();
  });
});
