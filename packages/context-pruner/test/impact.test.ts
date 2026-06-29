import type { CodeBlock } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { buildImpactPack } from "../src/pack.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;

function block(
  over: Partial<CodeBlock> & { name: string; filePath: string; calledBy: string[] },
): CodeBlock {
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
    calledBy: over.calledBy,
    keywords: over.keywords ?? [],
  };
}

// root <- mid <- top, plus sib -> root; unrelated has nothing to do with root.
function graph(): CodeBlock[] {
  return [
    block({ name: "root", filePath: "src/core.ts", calledBy: ["mid", "sib"] }),
    block({ name: "mid", filePath: "src/mid.ts", calls: ["root"], calledBy: ["top"] }),
    block({ name: "top", filePath: "src/top.ts", calls: ["mid"], calledBy: [] }),
    block({ name: "sib", filePath: "src/sib.ts", calls: ["root"], calledBy: [] }),
    block({ name: "unrelated", filePath: "src/other.ts", calledBy: [] }),
  ];
}

describe("buildImpactPack (reverse-BFS blast radius)", () => {
  it("returns the root plus exactly its transitive callers", () => {
    const pack = buildImpactPack({ symbol: "root", blocks: graph() });
    expect(pack.included.map((b) => b.name).sort()).toEqual(["mid", "root", "sib", "top"]);
    expect(pack.included.some((b) => b.name === "unrelated")).toBe(false);
  });

  it("excludes the root's own callees (forward edges are not blast radius)", () => {
    // top calls mid calls root; impact of mid = {mid, top} only — root is a callee.
    const pack = buildImpactPack({ symbol: "mid", blocks: graph() });
    expect(pack.included.map((b) => b.name).sort()).toEqual(["mid", "top"]);
  });

  it("returns an empty pack for an unknown symbol (no crash)", () => {
    const pack = buildImpactPack({ symbol: "doesNotExist", blocks: graph() });
    expect(pack.included).toEqual([]);
    expect(pack.budget.blocksConsidered).toBe(5);
  });

  it("never silently drops a caller: a budget-capped caller is reported, not hidden", () => {
    const blocks = [
      block({ name: "root", filePath: "src/core.ts", calledBy: ["a", "b"], endLine: 50 }),
      block({ name: "a", filePath: "src/a.ts", calls: ["root"], calledBy: [], endLine: 50 }),
      block({ name: "b", filePath: "src/b.ts", calls: ["root"], calledBy: [], endLine: 50 }),
    ];
    const pack = buildImpactPack({ symbol: "root", blocks, maxTokens: 1 });
    const names = new Set([
      ...pack.included.map((b) => b.name),
      ...pack.excluded.map((b) => b.name),
    ]);
    // every caller is accounted for somewhere — none vanishes silently.
    expect(names.has("a")).toBe(true);
    expect(names.has("b")).toBe(true);
  });

  it("never drops a transitive caller reachable only past a budget-cut node", () => {
    // chain root <- a <- b: with maxTokens too small for 'a', the walk must still
    // pass through 'a' to reach 'b'. 'b' must land in excluded, not vanish.
    const blocks = [
      block({ name: "root", filePath: "src/core.ts", calledBy: ["a"], endLine: 50 }),
      block({ name: "a", filePath: "src/a.ts", calls: ["root"], calledBy: ["b"], endLine: 50 }),
      block({ name: "b", filePath: "src/b.ts", calls: ["a"], calledBy: [], endLine: 50 }),
    ];
    const pack = buildImpactPack({ symbol: "root", blocks, maxTokens: 1 });
    expect(pack.included.map((b) => b.name)).toEqual(["root"]);
    const excludedNames = new Set(pack.excluded.map((b) => b.name));
    expect(excludedNames.has("a")).toBe(true);
    expect(excludedNames.has("b")).toBe(true);
  });
});
