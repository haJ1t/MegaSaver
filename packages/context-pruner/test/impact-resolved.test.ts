import type { CodeBlock } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { buildImpactPack } from "../src/pack.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000004" as ProjectId;
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
    calledBy: over.calledBy ?? [],
    keywords: over.keywords ?? [],
    ...(over.resolvedCalls !== undefined ? { resolvedCalls: over.resolvedCalls } : {}),
    ...(over.resolvedCalledBy !== undefined ? { resolvedCalledBy: over.resolvedCalledBy } : {}),
  };
}

// Two same-named `parse`: a.ts#parse called only by useA, b.ts#parse only by useB.
// Name-based calledBy lists BOTH callers on each (the false-edge bug); the
// resolved fields separate them.
function graph(): CodeBlock[] {
  return [
    block({
      name: "parse",
      filePath: "src/a.ts",
      exports: ["parse"],
      calledBy: ["useA", "useB"],
      resolvedCalledBy: ["src/usea.ts#useA"],
    }),
    block({
      name: "parse",
      filePath: "src/b.ts",
      exports: ["parse"],
      calledBy: ["useA", "useB"],
      resolvedCalledBy: ["src/useb.ts#useB"],
    }),
    block({
      name: "useA",
      filePath: "src/usea.ts",
      exports: ["useA"],
      calls: ["parse"],
      resolvedCalls: ["src/a.ts#parse"],
    }),
    block({
      name: "useB",
      filePath: "src/useb.ts",
      exports: ["useB"],
      calls: ["parse"],
      resolvedCalls: ["src/b.ts#parse"],
    }),
  ];
}

describe("buildImpactPack prefers resolved edges (cross-file disambiguation)", () => {
  it("impact of a.ts#parse includes only useA, never useB", () => {
    // selectImpact seeds by bare symbol `parse`; the first same-named block in
    // candidate order is a.ts#parse. Its resolvedCalledBy points only at useA.
    const pack = buildImpactPack({ symbol: "parse", blocks: graph() });
    const names = pack.included.map((b) => b.name);
    expect(names).toContain("useA");
    expect(names).not.toContain("useB");
  });

  it("falls back to name-based calledBy when a block has no resolved field", () => {
    // No resolvedCalledBy → old behavior: both callers reachable by name.
    const blocks = [
      block({ name: "root", filePath: "src/core.ts", exports: ["root"], calledBy: ["a", "b"] }),
      block({ name: "a", filePath: "src/a.ts", exports: ["a"], calls: ["root"] }),
      block({ name: "b", filePath: "src/b.ts", exports: ["b"], calls: ["root"] }),
    ];
    const pack = buildImpactPack({ symbol: "root", blocks });
    const names = pack.included.map((b) => b.name).sort();
    expect(names).toEqual(["a", "b", "root"]);
  });

  it("per-edge name fallback: an unresolved '#name' caller FQN still resolves", () => {
    // a.ts#parse is called precisely by useA AND via an unresolved edge by useNs
    // (a namespace-member call the build couldn't pin to a file → "#parse"). The
    // build records "#parse" alongside the precise FQN so the reverse walk still
    // reaches useNs by name fallback — no caller the name path had is lost.
    const blocks = [
      block({
        name: "parse",
        filePath: "src/a.ts",
        exports: ["parse"],
        calledBy: ["useA", "useNs"],
        resolvedCalledBy: ["src/usea.ts#useA", "#useNs"],
      }),
      block({
        name: "useA",
        filePath: "src/usea.ts",
        exports: ["useA"],
        calls: ["parse"],
        resolvedCalls: ["src/a.ts#parse"],
      }),
      block({
        name: "useNs",
        filePath: "src/usens.ts",
        exports: ["useNs"],
        calls: ["parse"],
        resolvedCalls: ["#parse"],
      }),
    ];
    const pack = buildImpactPack({ symbol: "parse", blocks });
    const names = pack.included.map((b) => b.name);
    expect(names).toContain("useA");
    expect(names).toContain("useNs");
  });
});
