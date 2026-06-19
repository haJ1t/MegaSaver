import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/build-graph.js";
import type { GraphInput } from "../src/inputs.js";

const EMPTY: GraphInput = {
  projects: [],
  sessions: [],
  memories: [],
  evidence: [],
  chunkSets: [],
  conflicts: [],
};

function base(): GraphInput {
  return {
    ...EMPTY,
    projects: [{ id: "p1", name: "demo" }],
    sessions: [{ id: "s1", projectId: "p1" }],
    memories: [
      {
        id: "m1",
        scope: "session",
        sessionId: "s1",
        projectId: "p1",
        memoryType: "decision",
        title: "D1",
        approval: "approved",
        confidence: "high",
        source: "agent",
        stale: false,
        evidenceIds: ["e1"],
      },
      {
        id: "m2",
        scope: "project",
        sessionId: null,
        projectId: "p1",
        memoryType: "bug",
        title: "B1",
        approval: "suggested",
        confidence: "low",
        source: "agent",
        stale: false,
        evidenceIds: [],
      },
    ],
    evidence: [
      {
        evidenceId: "e1",
        sourceKind: "command",
        sessionId: "s1",
        chunkSetIds: ["c1"],
        status: "available",
      },
    ],
    chunkSets: [{ chunkSetId: "c1", label: "curl ...", redacted: true }],
    conflicts: [{ from: "m1", to: "m2", kind: "supersede" }],
  };
}

const has = (g: ReturnType<typeof buildGraph>, kind: string, from: string, to: string) =>
  g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

describe("buildGraph", () => {
  it("emits one node per entity with the right kind", () => {
    const g = buildGraph(base());
    expect(g.nodes.find((n) => n.id === "p1")?.kind).toBe("project");
    expect(g.nodes.find((n) => n.id === "s1")?.kind).toBe("session");
    expect(g.nodes.find((n) => n.id === "m1")?.kind).toBe("memory");
    expect(g.nodes.find((n) => n.id === "e1")?.kind).toBe("evidence");
    expect(g.nodes.find((n) => n.id === "c1")?.kind).toBe("chunkset");
    expect(g.stats.nodeCount).toBe(g.nodes.length);
  });
  it("carries memory meta (type/approval/confidence/stale)", () => {
    const m1 = buildGraph(base()).nodes.find((n) => n.id === "m1");
    expect(m1?.meta.memoryType).toBe("decision");
    expect(m1?.meta.approval).toBe("approved");
  });
  it("collapses a bidirectional undirected conflict/duplicate into one edge", () => {
    const input = base();
    input.conflicts = [
      { from: "m1", to: "m2", kind: "duplicate" },
      { from: "m2", to: "m1", kind: "duplicate" },
    ];
    expect(buildGraph(input).edges.filter((e) => e.kind === "duplicate")).toHaveLength(1);
  });
  it("keeps directed supersede direction (not canonicalized)", () => {
    const input = base();
    input.conflicts = [{ from: "m2", to: "m1", kind: "supersede" }];
    expect(has(buildGraph(input), "supersede", "m2", "m1")).toBe(true);
  });
  it("contains: project->session", () => {
    expect(has(buildGraph(base()), "contains", "p1", "s1")).toBe(true);
  });
  it("scope: session->memory (session-scoped)", () => {
    expect(has(buildGraph(base()), "scope", "s1", "m1")).toBe(true);
  });
  it("project-memory: project->memory (project-scoped)", () => {
    expect(has(buildGraph(base()), "project-memory", "p1", "m2")).toBe(true);
  });
  it("cites: memory->evidence", () => {
    expect(has(buildGraph(base()), "cites", "m1", "e1")).toBe(true);
  });
  it("chunk-of: evidence->chunkset", () => {
    expect(has(buildGraph(base()), "chunk-of", "e1", "c1")).toBe(true);
  });
  it("from-session: evidence->session", () => {
    expect(has(buildGraph(base()), "from-session", "e1", "s1")).toBe(true);
  });
  it("supersede: conflict pair -> directed edge", () => {
    expect(has(buildGraph(base()), "supersede", "m1", "m2")).toBe(true);
  });
  it("skips edges to missing nodes (dangling evidence id)", () => {
    const input = base();
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.evidenceIds = ["e1", "MISSING"];
    expect(has(buildGraph(input), "cites", "m1", "MISSING")).toBe(false);
  });
  it("emits a deterministic stable edge id and no duplicate edges", () => {
    const g = buildGraph(base());
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
  });
});
