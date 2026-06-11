import type { CodeBlock } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { scoreBlocks } from "../src/score.js";
import { selectPack } from "../src/select.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;

function block(over: Partial<CodeBlock> & { name: string; filePath: string }): CodeBlock {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    filePath: over.filePath,
    startLine: over.startLine ?? 1,
    endLine: over.endLine ?? 6,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: `h${n}`,
    imports: over.imports ?? [],
    exports: over.exports ?? [],
    calls: over.calls ?? [],
    calledBy: [],
    keywords: over.keywords ?? [],
  };
}

describe("selectPack", () => {
  it("honors the limit on relevance-selected blocks", () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      block({ name: `fn${i}`, filePath: `src/f${i}.ts`, keywords: ["auth"] }),
    );
    const sel = selectPack(scoreBlocks({ task: "auth", blocks }), { limit: 5 });
    expect(sel.included.length).toBe(5);
    expect(sel.excluded.some((e) => e.reason === "budget")).toBe(true);
  });

  it("pulls a called helper in via dependency closure even at low relevance", () => {
    const blocks = [
      block({
        name: "handler",
        filePath: "src/handler.ts",
        keywords: ["auth", "login"],
        calls: ["helper"],
      }),
      block({ name: "helper", filePath: "src/util.ts", keywords: ["zzz"] }),
    ];
    const sel = selectPack(scoreBlocks({ task: "auth login", blocks }), { limit: 8 });
    const helper = sel.included.find((c) => c.block.name === "helper");
    expect(helper).toBeDefined();
    expect(helper?.factors.dependencyRelevance).toBe(1);
  });

  it("never drops a named block, even under a tiny token budget", () => {
    const blocks = [
      block({ name: "validateToken", filePath: "src/auth.ts", endLine: 200 }),
      block({ name: "other", filePath: "src/other.ts", keywords: ["auth"], endLine: 200 }),
    ];
    const sel = selectPack(scoreBlocks({ task: "fix validateToken", blocks }), { maxTokens: 1 });
    expect(sel.included.some((c) => c.block.name === "validateToken")).toBe(true);
    // the forced block overflows the budget — surfaced, not hidden
    expect(sel.usedTokens).toBeGreaterThan(1);
  });

  it("labels score<min as irrelevant, cut-by-budget as budget", () => {
    const blocks = [
      block({ name: "match", filePath: "src/a.ts", keywords: ["auth"] }),
      block({ name: "noise", filePath: "dist/bundle.js", keywords: ["auth"] }),
    ];
    const sel = selectPack(scoreBlocks({ task: "auth", blocks }), { limit: 8 });
    expect(sel.excluded.find((e) => e.candidate.block.name === "noise")?.reason).toBe("irrelevant");
  });
});
