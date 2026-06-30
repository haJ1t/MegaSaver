import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/build-graph.js";
import type { GraphInput, MemoryInput } from "../src/inputs.js";

function mem(over: Partial<MemoryInput> & { id: string }): MemoryInput {
  return {
    id: over.id,
    scope: over.scope ?? "project",
    sessionId: over.sessionId ?? null,
    projectId: over.projectId ?? "p1",
    memoryType: over.memoryType ?? "decision",
    title: over.title ?? over.id,
    approval: over.approval ?? "approved",
    confidence: over.confidence ?? "high",
    source: over.source ?? "agent",
    stale: over.stale ?? false,
    evidenceIds: over.evidenceIds ?? [],
    relatedFiles: over.relatedFiles ?? [],
    relatedSymbols: over.relatedSymbols ?? [],
  };
}

function input(memories: MemoryInput[]): GraphInput {
  return {
    projects: [{ id: "p1", name: "demo" }],
    sessions: [],
    memories,
    evidence: [],
    chunkSets: [],
    conflicts: [],
    files: [],
    symbols: [],
    wikiPages: [],
  };
}

const SYM_ENTITY = "entity:symbol:buildGraph";
const FILE_ENTITY = "entity:file:packages/core/src/x.ts";

describe("entity layer — deterministic extraction (no model)", () => {
  it("creates one entity node per distinct symbol/file and entity-mention edges per memory", () => {
    const g = buildGraph(
      input([
        mem({ id: "m1", relatedSymbols: ["buildGraph"], relatedFiles: ["packages/core/src/x.ts"] }),
        mem({ id: "m2", relatedSymbols: ["buildGraph"] }),
      ]),
    );

    // One symbol entity node shared by both memories (first-writer-wins dedup).
    const symEntities = g.nodes.filter((n) => n.id === SYM_ENTITY);
    expect(symEntities).toHaveLength(1);
    expect(symEntities[0]?.kind).toBe("entity");

    // One file entity node from m1.
    expect(g.nodes.filter((n) => n.id === FILE_ENTITY)).toHaveLength(1);

    // Both memories mention the symbol entity → two entity-mention edges into it.
    const mentions = g.edges.filter((e) => e.kind === "entity-mention" && e.to === SYM_ENTITY);
    expect(mentions.map((e) => e.from).sort()).toEqual(["m1", "m2"]);

    // m1 also mentions the file entity.
    expect(
      g.edges.some((e) => e.kind === "entity-mention" && e.from === "m1" && e.to === FILE_ENTITY),
    ).toBe(true);
  });

  it("aggregation: every memory mentioning entity X is reachable via entity-mention edges", () => {
    const g = buildGraph(
      input([
        mem({ id: "m1", relatedSymbols: ["Widget"] }),
        mem({ id: "m2", relatedSymbols: ["Widget"] }),
        mem({ id: "m3", relatedSymbols: ["Other"] }),
      ]),
    );
    const widgetMentioners = g.edges
      .filter((e) => e.kind === "entity-mention" && e.to === "entity:symbol:Widget")
      .map((e) => e.from)
      .sort();
    expect(widgetMentioners).toEqual(["m1", "m2"]);
  });

  it("entity ids are disjoint from the existing file:/symbol: code-node ids", () => {
    const g = buildGraph({
      ...input([mem({ id: "m1", relatedSymbols: ["buildGraph"] })]),
      symbols: [{ symbol: "buildGraph" }],
    });
    // Both the code-link symbol node and the entity node exist, distinct ids.
    expect(g.nodes.some((n) => n.id === "symbol:buildGraph" && n.kind === "symbol")).toBe(true);
    expect(g.nodes.some((n) => n.id === SYM_ENTITY && n.kind === "entity")).toBe(true);
  });

  it("a memory with no relatedSymbols/relatedFiles produces no entity nodes or edges", () => {
    const g = buildGraph(input([mem({ id: "m1" })]));
    expect(g.nodes.some((n) => n.kind === "entity")).toBe(false);
    expect(g.edges.some((e) => e.kind === "entity-mention")).toBe(false);
  });
});
