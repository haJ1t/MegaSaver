import { describe, expect, it } from "vitest";
import { edgeKindSchema, graphSchema, nodeKindSchema } from "../src/model.js";

describe("memory-graph model", () => {
  it("accepts every Phase 1 node + edge kind", () => {
    for (const k of ["project", "session", "memory", "evidence", "chunkset"]) {
      expect(nodeKindSchema.parse(k)).toBe(k);
    }
    for (const k of [
      "contains",
      "scope",
      "project-memory",
      "cites",
      "chunk-of",
      "from-session",
      "conflict",
      "supersede",
      "duplicate",
    ]) {
      expect(edgeKindSchema.parse(k)).toBe(k);
    }
  });
  it("accepts every Phase 2 node + edge kind", () => {
    for (const k of [
      "project",
      "session",
      "memory",
      "evidence",
      "chunkset",
      "file",
      "symbol",
      "wiki",
    ]) {
      expect(nodeKindSchema.parse(k)).toBe(k);
    }
    for (const k of [
      "contains",
      "scope",
      "project-memory",
      "cites",
      "chunk-of",
      "from-session",
      "conflict",
      "supersede",
      "duplicate",
      "code-link",
      "wiki-link",
      "wiki-source",
      "wiki-cite",
    ]) {
      expect(edgeKindSchema.parse(k)).toBe(k);
    }
  });
  it("validates a minimal graph", () => {
    const g = graphSchema.parse({
      nodes: [{ id: "m1", kind: "memory", label: "X", meta: {} }],
      edges: [],
      stats: { nodeCount: 1, edgeCount: 0 },
    });
    expect(g.nodes[0]?.kind).toBe("memory");
  });
  it("rejects an unknown node kind", () => {
    expect(() => nodeKindSchema.parse("banana")).toThrow();
  });
  it("rejects a graph with an unknown edge kind", () => {
    expect(() =>
      graphSchema.parse({
        nodes: [
          { id: "a", kind: "memory", label: "A", meta: {} },
          { id: "b", kind: "memory", label: "B", meta: {} },
        ],
        edges: [{ id: "e1", kind: "banana", from: "a", to: "b" }],
        stats: { nodeCount: 2, edgeCount: 1 },
      }),
    ).toThrow();
  });
  it("round-trips a graph with an edge and multi-key meta", () => {
    const g = graphSchema.parse({
      nodes: [
        { id: "a", kind: "wiki", label: "A", meta: { tags: ["x"], status: "active" } },
        { id: "b", kind: "file", label: "b.ts", meta: {} },
      ],
      edges: [{ id: "e1", kind: "wiki-cite", from: "a", to: "b" }],
      stats: { nodeCount: 2, edgeCount: 1 },
    });
    expect(g.edges[0]?.kind).toBe("wiki-cite");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(g.nodes[0]?.meta["status"]).toBe("active");
  });
});
