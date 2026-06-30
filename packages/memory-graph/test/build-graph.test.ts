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
        relatedFiles: ["packages/core/src/x.ts"],
        relatedSymbols: ["buildGraph"],
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
        relatedFiles: [],
        relatedSymbols: [],
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
    files: [{ path: "packages/core/src/x.ts" }],
    symbols: [{ symbol: "buildGraph" }],
    wikiPages: [
      {
        path: "entities/core.md",
        title: "core",
        tags: [],
        status: "active",
        links: ["decisions/bootstrap-matrix"],
        sources: ["concepts/foo.md"],
        fileCites: ["packages/core/src/x.ts"],
      },
      {
        path: "decisions/bootstrap-matrix.md",
        title: "bootstrap",
        tags: [],
        status: "active",
        links: [],
        sources: [],
        fileCites: [],
      },
      {
        path: "concepts/foo.md",
        title: "foo",
        tags: [],
        status: "active",
        links: [],
        sources: [],
        fileCites: [],
      },
    ],
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
  it("edgeCount matches edges.length and the base fixture's emitted edge count", () => {
    const g = buildGraph(base());
    expect(g.stats.edgeCount).toBe(g.edges.length);
    // 12 base edges + 2 entity-mention edges (m1's one relatedFile + one
    // relatedSymbol each become an entity a memory mentions).
    expect(g.stats.edgeCount).toBe(14);
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

describe("buildGraph — file/symbol/wiki nodes + edges", () => {
  it("emits file node for each input.files entry", () => {
    const g = buildGraph(base());
    expect(g.nodes.some((n) => n.kind === "file" && n.id === "file:packages/core/src/x.ts")).toBe(
      true,
    );
  });
  it("emits symbol node for each input.symbols entry", () => {
    const g = buildGraph(base());
    expect(g.nodes.some((n) => n.kind === "symbol" && n.id === "symbol:buildGraph")).toBe(true);
  });
  it("emits wiki node for each input.wikiPages entry", () => {
    const g = buildGraph(base());
    expect(g.nodes.some((n) => n.kind === "wiki" && n.id === "wiki:entities/core.md")).toBe(true);
    expect(
      g.nodes.some((n) => n.kind === "wiki" && n.id === "wiki:decisions/bootstrap-matrix.md"),
    ).toBe(true);
    expect(g.nodes.some((n) => n.kind === "wiki" && n.id === "wiki:concepts/foo.md")).toBe(true);
  });
  it("code-link: memory -> relatedFiles", () => {
    const g = buildGraph(base());
    expect(has(g, "code-link", "m1", "file:packages/core/src/x.ts")).toBe(true);
  });
  it("code-link: memory -> relatedSymbols", () => {
    const g = buildGraph(base());
    expect(has(g, "code-link", "m1", "symbol:buildGraph")).toBe(true);
  });
  it("wiki-link: resolved via path-without-.md key", () => {
    const g = buildGraph(base());
    // link "decisions/bootstrap-matrix" (no .md) resolves to "decisions/bootstrap-matrix.md"
    expect(has(g, "wiki-link", "wiki:entities/core.md", "wiki:decisions/bootstrap-matrix.md")).toBe(
      true,
    );
  });
  it("wiki-source: resolved via exact path key", () => {
    const g = buildGraph(base());
    // source "concepts/foo.md" resolves exactly
    expect(has(g, "wiki-source", "wiki:entities/core.md", "wiki:concepts/foo.md")).toBe(true);
  });
  it("wiki-cite: wiki -> shared file node", () => {
    const g = buildGraph(base());
    expect(has(g, "wiki-cite", "wiki:entities/core.md", "file:packages/core/src/x.ts")).toBe(true);
  });
  it("shared file node: exactly one node despite two referrers (memory + wiki)", () => {
    const g = buildGraph(base());
    expect(g.nodes.filter((n) => n.id === "file:packages/core/src/x.ts")).toHaveLength(1);
  });
  it("dangling wiki-link: no edge emitted", () => {
    const input = base();
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.wikiPages[0]!.links.push("nope/does-not-exist");
    const g = buildGraph(input);
    expect(g.edges.some((e) => e.kind === "wiki-link" && e.to === "nope/does-not-exist")).toBe(
      false,
    );
    expect(g.edges.some((e) => e.kind === "wiki-link" && e.to === "nope/does-not-exist.md")).toBe(
      false,
    );
  });
  it("code-link to file not in input.files is dropped", () => {
    const input = base();
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.relatedFiles = ["packages/core/src/x.ts", "packages/ghost/not-listed.ts"];
    const g = buildGraph(input);
    expect(has(g, "code-link", "m1", "file:packages/ghost/not-listed.ts")).toBe(false);
  });
  it("a .md cited as a file and a wiki page at that path are two distinct nodes", () => {
    const input = base();
    const wiki = (
      path: string,
      title: string,
      fileCites: string[],
    ): GraphInput["wikiPages"][number] => ({
      path,
      title,
      tags: ["roadmap"],
      status: "active",
      links: [],
      sources: [],
      fileCites,
    });
    input.files = [{ path: "a/b.md" }];
    input.memories = [];
    input.symbols = [];
    input.conflicts = [];
    input.wikiPages = [wiki("citer.md", "Citer", ["a/b.md"]), wiki("a/b.md", "Target", [])];
    const g = buildGraph(input);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
    expect(g.nodes.filter((n) => n.kind === "file" && n.id === "file:a/b.md")).toHaveLength(1);
    const wikiTarget = g.nodes.filter((n) => n.kind === "wiki" && n.id === "wiki:a/b.md");
    expect(wikiTarget).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    const node = wikiTarget[0]!;
    expect(node.label).toBe("Target");
    expect(node.meta.tags).toEqual(["roadmap"]);
    expect(has(g, "wiki-cite", "wiki:citer.md", "file:a/b.md")).toBe(true);
  });
  it("collapses ./-prefixed memory relatedFiles with clean wiki fileCites into one file node", () => {
    const input = base();
    input.files = [{ path: "./docs/x.md" }, { path: "docs/x.md" }];
    input.symbols = [];
    input.conflicts = [];
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.relatedFiles = ["./docs/x.md"];
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.relatedSymbols = [];
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.wikiPages[0]!.fileCites = ["docs/x.md"];
    const g = buildGraph(input);
    expect(g.nodes.filter((n) => n.id === "file:docs/x.md")).toHaveLength(1);
    expect(g.nodes.some((n) => n.id === "file:./docs/x.md")).toBe(false);
    expect(has(g, "code-link", "m1", "file:docs/x.md")).toBe(true);
    expect(has(g, "wiki-cite", "wiki:entities/core.md", "file:docs/x.md")).toBe(true);
  });
  it("path == symbol: distinct file and symbol nodes, both code-links survive", () => {
    const input = base();
    input.conflicts = [];
    input.wikiPages = [];
    input.files = [{ path: "foo" }];
    input.symbols = [{ symbol: "foo" }];
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.relatedFiles = ["foo"];
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.relatedSymbols = ["foo"];
    // biome-ignore lint/style/noNonNullAssertion: noUncheckedIndexedAccess requires ! for array index
    input.memories[0]!.evidenceIds = [];
    const g = buildGraph(input);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
    expect(g.nodes.filter((n) => n.kind === "file" && n.meta.path === "foo")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "symbol" && n.label === "foo")).toHaveLength(1);
    expect(g.edges.filter((e) => e.kind === "code-link" && e.from === "m1")).toHaveLength(2);
  });
  it("ambiguous basename: shared basename resolves to nothing, full path still wins", () => {
    const input = base();
    const wiki = (path: string, links: string[]): GraphInput["wikiPages"][number] => ({
      path,
      title: path,
      tags: [],
      status: "active",
      links,
      sources: [],
      fileCites: [],
    });
    input.wikiPages = [
      wiki("a/dup.md", []),
      wiki("b/dup.md", []),
      wiki("ambiguous-ref.md", ["dup"]),
      wiki("specific-ref.md", ["a/dup"]),
    ];
    const g = buildGraph(input);
    // bare [[dup]] is ambiguous across a/dup.md and b/dup.md -> no edge from ambiguous-ref
    expect(has(g, "wiki-link", "wiki:ambiguous-ref.md", "wiki:a/dup.md")).toBe(false);
    expect(has(g, "wiki-link", "wiki:ambiguous-ref.md", "wiki:b/dup.md")).toBe(false);
    // full path-without-.md [[a/dup]] is unique -> resolves
    expect(has(g, "wiki-link", "wiki:specific-ref.md", "wiki:a/dup.md")).toBe(true);
  });
});
