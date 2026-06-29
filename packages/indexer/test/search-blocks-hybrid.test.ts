import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type CodeBlock, codeBlockSchema } from "../src/code-block.js";
import { searchBlocks } from "../src/search-blocks.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;

function block(id: string, over: Partial<CodeBlock> & { name: string }): CodeBlock {
  return codeBlockSchema.parse({
    id,
    projectId: PROJECT_ID,
    filePath: over.filePath ?? "src/x.ts",
    startLine: 1,
    endLine: 5,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: id,
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: over.keywords ?? [],
  });
}

const A1 = "00000000-0000-4000-8000-0000000000a1";
const A2 = "00000000-0000-4000-8000-0000000000a2";

describe("searchBlocks — hybrid rerank", () => {
  // Two blocks with identical lexical docs → BM25 ties; tie-break would order
  // by rankBm25's stable index. With vectors, the cosine-near block must win.
  const blocks = [
    block(A1, { name: "load", filePath: "src/a.ts", keywords: ["data", "io"] }),
    block(A2, { name: "load", filePath: "src/b.ts", keywords: ["data", "io"] }),
  ];

  it("reranks by cosine when a taskVector + blockVectors are provided", () => {
    const taskVector = Float32Array.from([0, 1, 0]);
    const blockVectors = new Map<string, Float32Array>([
      [A1, Float32Array.from([1, 0, 0])], // far from task
      [A2, Float32Array.from([0, 0.95, 0])], // near task
    ]);
    const hits = searchBlocks(blocks, { text: "load data io" }, { taskVector, blockVectors });
    expect(hits[0]?.block.id).toBe(A2);
  });

  it("falls back to pure BM25 when no vectors are provided (identical to today)", () => {
    const baseline = searchBlocks(blocks, { text: "load data io" });
    const same = searchBlocks(blocks, { text: "load data io" }, undefined);
    expect(same.map((h) => h.block.id)).toEqual(baseline.map((h) => h.block.id));
  });

  it("falls back to BM25 when a taskVector is given but the block has no vector", () => {
    const baseline = searchBlocks(blocks, { text: "load data io" });
    const partial = searchBlocks(
      blocks,
      { text: "load data io" },
      { taskVector: Float32Array.from([0, 1, 0]), blockVectors: new Map() },
    );
    expect(partial.map((h) => h.block.id)).toEqual(baseline.map((h) => h.block.id));
  });
});
