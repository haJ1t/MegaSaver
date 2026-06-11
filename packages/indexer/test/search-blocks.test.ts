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

describe("searchBlocks", () => {
  const blocks = [
    block("00000000-0000-4000-8000-0000000000a1", {
      name: "validateToken",
      filePath: "src/auth.ts",
      keywords: ["auth", "token"],
    }),
    block("00000000-0000-4000-8000-0000000000a2", { name: "Navbar", blockType: "component" }),
  ];

  it("ranks a matching block first and drops non-matches", () => {
    const hits = searchBlocks(blocks, { text: "validateToken auth" });
    expect(hits[0]?.block.id).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(hits.map((h) => h.block.id)).not.toContain("00000000-0000-4000-8000-0000000000a2");
  });

  it("filters by block type before ranking", () => {
    const hits = searchBlocks(blocks, { text: "Navbar", type: "component" });
    expect(hits.map((h) => h.block.name)).toEqual(["Navbar"]);
  });

  it("returns empty for an empty index", () => {
    expect(searchBlocks([], { text: "anything" })).toEqual([]);
  });
});
