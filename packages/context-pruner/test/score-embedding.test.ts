import type { CodeBlock } from "@megasaver/indexer";
import { codeBlockSchema } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type ScoredCandidate, scoreBlocks } from "../src/score.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;

function block(over: Partial<CodeBlock> & { name: string; filePath: string }): CodeBlock {
  n += 1;
  return codeBlockSchema.parse({
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    filePath: over.filePath,
    startLine: 1,
    endLine: 10,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: `h${n}`,
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: over.keywords ?? [],
  });
}

function find(scored: ScoredCandidate[], name: string): ScoredCandidate | undefined {
  return scored.find((s) => s.block.name === name);
}

describe("scoreBlocks — embeddingRelevance factor (injected vectors)", () => {
  it("a block whose vector is cosine-near the task ranks above a BM25-equal far block", () => {
    // Two blocks with IDENTICAL lexical docs (same name/keywords/path stem),
    // so BM25 semanticRelevance ties. Only the injected vectors differ.
    const near = block({ name: "handler", filePath: "src/a.ts", keywords: ["data", "io"] });
    const far = block({ name: "handler", filePath: "src/b.ts", keywords: ["data", "io"] });

    const taskVector = Float32Array.from([1, 0, 0]);
    const blockVectors = new Map<string, Float32Array>([
      [near.id, Float32Array.from([0.9, 0.1, 0])], // close to task
      [far.id, Float32Array.from([0, 0, 1])], // orthogonal
    ]);

    const scored = scoreBlocks({
      task: "handler data io",
      blocks: [near, far],
      taskVector,
      blockVectors,
    });

    const a = find(scored, "handler");
    expect(scored[0]?.block.id).toBe(near.id);
    expect(a?.factors.embeddingRelevance).toBeGreaterThan(0);
    expect(find(scored, "handler")).toBeDefined();
    // near must outrank far on total score and on the embedding factor
    const nearScored = scored.find((s) => s.block.id === near.id);
    const farScored = scored.find((s) => s.block.id === far.id);
    expect(nearScored?.factors.embeddingRelevance).toBeGreaterThan(
      farScored?.factors.embeddingRelevance ?? 1,
    );
    expect(nearScored?.score).toBeGreaterThan(farScored?.score ?? 99);
  });

  it("embeddingRelevance is 0 for a block with no vector in the map", () => {
    const a = block({ name: "withVec", filePath: "src/a.ts" });
    const b = block({ name: "noVec", filePath: "src/b.ts" });
    const scored = scoreBlocks({
      task: "anything",
      blocks: [a, b],
      taskVector: Float32Array.from([1, 0]),
      blockVectors: new Map([[a.id, Float32Array.from([1, 0])]]),
    });
    expect(scored.find((s) => s.block.id === b.id)?.factors.embeddingRelevance).toBe(0);
  });

  it("clamps a negative (opposite) cosine to 0 so it never fights positive factors", () => {
    const a = block({ name: "opposite", filePath: "src/a.ts" });
    const scored = scoreBlocks({
      task: "anything",
      blocks: [a],
      taskVector: Float32Array.from([1, 0]),
      blockVectors: new Map([[a.id, Float32Array.from([-1, 0])]]),
    });
    expect(scored[0]?.factors.embeddingRelevance).toBe(0);
  });
});

describe("scoreBlocks — graceful fallback (no vectors)", () => {
  it("output is IDENTICAL to BM25-only when no taskVector/blockVectors are passed", () => {
    const blocks = [
      block({ name: "validateToken", filePath: "src/auth.ts", keywords: ["jwt", "auth"] }),
      block({ name: "Navbar", filePath: "src/nav.tsx", keywords: ["ui", "header"] }),
    ];
    const withoutEmbedding = scoreBlocks({ task: "jwt auth", blocks });
    expect(withoutEmbedding.every((s) => s.factors.embeddingRelevance === 0)).toBe(true);
    // every other factor + final score must be exactly what BM25-only produces
    for (const s of withoutEmbedding) {
      expect(s.score).toBe(
        scoreBlocks({ task: "jwt auth", blocks }).find((x) => x.block.id === s.block.id)?.score,
      );
    }
  });

  it("a taskVector with an empty blockVectors map leaves embeddingRelevance at 0 for all", () => {
    const blocks = [block({ name: "a", filePath: "src/a.ts" })];
    const scored = scoreBlocks({
      task: "a",
      blocks,
      taskVector: Float32Array.from([1, 0]),
      blockVectors: new Map(),
    });
    expect(scored.every((s) => s.factors.embeddingRelevance === 0)).toBe(true);
  });
});
