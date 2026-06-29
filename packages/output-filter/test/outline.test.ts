import { describe, expect, it } from "vitest";
import { outlineFile, renderSignature } from "../src/parsers/outline.js";

const TS = `import { z } from "zod";
import { join } from "node:path";

export function alpha(a: number): number {
  return a + 1;
}

export class Beta {
  run(): void {}
}

const gamma = (
  x: string,
  y: string,
) => x + y;
`;

describe("renderSignature", () => {
  it("returns a single-line signature without the body brace", () => {
    const lines = TS.split("\n");
    expect(renderSignature(lines, 4, 6, "a.ts")).toBe("export function alpha(a: number): number");
  });

  it("keeps multi-line wrapped params up to the opener", () => {
    const lines = TS.split("\n");
    const sig = renderSignature(lines, 12, 15, "a.ts");
    expect(sig).toContain("const gamma = (");
    expect(sig).toContain("y: string,");
  });

  it("uses only the first line for markdown headings", () => {
    expect(renderSignature(["## Title", "body"], 1, 2, "a.md")).toBe("## Title");
  });

  it("uses the colon opener for python signatures", () => {
    expect(renderSignature(["def foo(x):", "  return x"], 1, 2, "a.py")).toBe("def foo(x):");
  });
});

describe("outlineFile", () => {
  it("returns null for unsupported extensions", async () => {
    expect(await outlineFile("whatever", "a.bin")).toBeNull();
  });

  it("returns null when nothing extracts", async () => {
    expect(await outlineFile("", "a.ts")).toBeNull();
  });

  it("builds a skeleton with one chunk per declaration and matching ids", async () => {
    const result = await outlineFile(TS, "a.ts");
    expect(result).not.toBeNull();
    if (result === null) return;
    const { skeleton, chunks } = result;
    expect(skeleton).toContain("zod");
    expect(skeleton).toContain("node:path");
    expect(skeleton).toMatch(/#\d+ {2}L\d+-\d+ {2}export function alpha/);
    const ids = [...skeleton.matchAll(/#(\d+) {2}L/g)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      expect(chunks[id]).toBeDefined();
    }
    const alphaId = ids.find((id) => chunks[id]?.text.includes("return a + 1;"));
    expect(alphaId).toBeDefined();
  });

  it("covers every source line across the chunk set (lossless)", async () => {
    const result = await outlineFile(TS, "a.ts");
    if (result === null) throw new Error("expected outline");
    const covered = new Set<number>();
    for (const c of result.chunks) {
      for (let ln = c.startLine; ln <= c.endLine; ln++) covered.add(ln);
    }
    const lines = TS.split("\n");
    for (let ln = 1; ln <= lines.length; ln++) {
      if (lines[ln - 1]?.trim() !== "") expect(covered.has(ln)).toBe(true);
    }
  });

  it("collapses co-located declarations on one line to unique skeleton ids", async () => {
    const src = "export const a = () => 1; export const b = () => 2;\n";
    const result = await outlineFile(src, "x.ts");
    if (result === null) throw new Error("expected outline");
    const ids = [...result.skeleton.matchAll(/#(\d+) {2}L/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate #ids
    for (const id of ids) expect(result.chunks[Number(id)]).toBeDefined();
  });
});
