import { describe, expect, it } from "vitest";
import type { SessionDecisionTrace } from "../../src/lib/decision-trace-client.js";
import { toDecisionGraph } from "../../src/lib/decision-trace-graph.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const MEM_A = "33333333-3333-4333-8333-333333333333";
const MEM_B = "44444444-4444-4444-8444-444444444444";

function engine(memoryBoost: number) {
  return { baseRelevance: 0.7, memoryBoost, failureHistoryBoost: 0, finalScore: 0.9 };
}

// Two outputs. Output 1 (cs1) is pinned by MEM_A and redacted; output 2 (cs2)
// is pinned by MEM_A *and* MEM_B and NOT redacted. MEM_A appears on both outputs
// so the projection must dedupe it into ONE memory node.
const TRACE: SessionDecisionTrace = {
  projectId: PROJECT,
  sessionId: SESSION,
  outputs: [
    {
      chunkSetId: "cs1",
      toolName: "Read",
      createdAt: "2026-07-04T00:00:00.000Z",
      classification: { category: "typescript", confidence: 0.7 },
      decision: "compressed",
      selected: [{ startLine: 1, endLine: 10, score: 0.9, engine: engine(0.2) }],
      omitted: [],
      memory: { rankedByMemoryIds: [MEM_A] },
      redaction: { redacted: true, highRiskFindings: 2 },
      evidencePresent: true,
    },
    {
      chunkSetId: "cs2",
      toolName: "Bash",
      createdAt: "2026-07-04T00:01:00.000Z",
      classification: { category: "generic", confidence: 0.5 },
      decision: "light",
      selected: [
        { startLine: 20, endLine: 25, score: 0.6, engine: engine(0.5) },
        { startLine: 30, endLine: 40, score: 0.4, engine: engine(0) },
      ],
      omitted: [],
      memory: { rankedByMemoryIds: [MEM_A, MEM_B] },
      redaction: { redacted: false, highRiskFindings: 0 },
      evidencePresent: true,
    },
  ],
};

describe("toDecisionGraph", () => {
  it("emits an output node per output labelled with tool + decision", () => {
    const g = toDecisionGraph(TRACE);
    const outputs = g.nodes.filter((n) => n.kind === "output");
    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.label).toMatch(/Read/);
    expect(outputs[0]?.label).toMatch(/compressed/);
    expect(outputs[1]?.label).toMatch(/Bash/);
    expect(outputs[1]?.label).toMatch(/light/);
  });

  it("emits a chunk node per selected chunk with a line-range label and score/engine meta", () => {
    const g = toDecisionGraph(TRACE);
    const chunks = g.nodes.filter((n) => n.kind === "chunk");
    expect(chunks).toHaveLength(3); // 1 + 2
    const c0 = chunks.find((n) => n.label === "lines 1-10");
    expect(c0).toBeDefined();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(c0?.meta["score"]).toBe(0.9);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(c0?.meta["memoryBoost"]).toBe(0.2);
  });

  it("dedupes a memory pinned across multiple outputs into one node", () => {
    const g = toDecisionGraph(TRACE);
    const memories = g.nodes.filter((n) => n.kind === "memory");
    expect(memories).toHaveLength(2); // MEM_A (deduped) + MEM_B
    expect(memories.map((n) => n.id).sort()).toEqual([MEM_A, MEM_B].sort());
  });

  it("emits a redaction node only for redacted outputs, labelled from highRiskFindings", () => {
    const g = toDecisionGraph(TRACE);
    const redactions = g.nodes.filter((n) => n.kind === "redaction");
    expect(redactions).toHaveLength(1); // only output 1 is redacted
    expect(redactions[0]?.label).toMatch(/2/);
  });

  it("wires ranked (output→chunk), pinned (memory→output), redacted (output→redaction) edges", () => {
    const g = toDecisionGraph(TRACE);
    const ranked = g.edges.filter((e) => e.kind === "ranked");
    const pinned = g.edges.filter((e) => e.kind === "pinned");
    const redacted = g.edges.filter((e) => e.kind === "redacted");
    expect(ranked).toHaveLength(3); // one per chunk
    expect(pinned).toHaveLength(3); // MEM_A→o1, MEM_A→o2, MEM_B→o2
    expect(redacted).toHaveLength(1);
    // pinned edge points memory → output
    const outputIds = new Set(g.nodes.filter((n) => n.kind === "output").map((n) => n.id));
    expect(pinned.every((e) => outputIds.has(e.target))).toBe(true);
    expect(pinned.some((e) => e.source === MEM_A)).toBe(true);
    // ranked edge points output → chunk
    const chunkIds = new Set(g.nodes.filter((n) => n.kind === "chunk").map((n) => n.id));
    expect(ranked.every((e) => outputIds.has(e.source) && chunkIds.has(e.target))).toBe(true);
    // redacted edge points output → redaction
    const redactionIds = new Set(g.nodes.filter((n) => n.kind === "redaction").map((n) => n.id));
    expect(redacted.every((e) => outputIds.has(e.source) && redactionIds.has(e.target))).toBe(true);
  });

  it("reports stats: outputs, chunks, distinct memoriesPinned", () => {
    const g = toDecisionGraph(TRACE);
    expect(g.stats.outputs).toBe(2);
    expect(g.stats.chunks).toBe(3);
    expect(g.stats.memoriesPinned).toBe(2); // MEM_A + MEM_B, deduped
  });

  it("returns an empty graph for a trace with no outputs", () => {
    const g = toDecisionGraph({ projectId: PROJECT, sessionId: SESSION, outputs: [] });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.stats).toEqual({ outputs: 0, chunks: 0, memoriesPinned: 0 });
  });
});
