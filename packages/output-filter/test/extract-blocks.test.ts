import { describe, expect, it } from "vitest";
import { extractBlocksForFile } from "../src/index.js";

const TS_SOURCE = `export function alpha(a: number): number {
  return a + 1;
}

export function beta(): void {}
`;

const PY_SOURCE = `def alpha(a):
    return a + 1

class Beta:
    def run(self):
        return 2
`;

describe("extractBlocksForFile", () => {
  it("extracts named TS blocks with contentHash and line spans", async () => {
    const blocks = await extractBlocksForFile("src/a.ts", TS_SOURCE);
    expect(blocks).toBeDefined();
    const alpha = blocks?.find((b) => b.name === "alpha");
    expect(alpha).toBeDefined();
    expect((alpha?.contentHash.length ?? 0) > 0).toBe(true);
    expect(alpha?.startLine).toBeGreaterThan(0);
    expect(alpha?.endLine).toBeGreaterThanOrEqual(alpha?.startLine ?? Number.MAX_SAFE_INTEGER);
  });

  it("dispatches Python sources to the py extractor", async () => {
    const blocks = await extractBlocksForFile("src/b.py", PY_SOURCE);
    expect(blocks?.some((b) => b.name === "alpha")).toBe(true);
    expect(blocks?.some((b) => b.name === "Beta")).toBe(true);
  });

  it("returns undefined for an unsupported extension", async () => {
    expect(await extractBlocksForFile("notes.txt", "hello world")).toBeUndefined();
  });

  it("returns undefined for an extensionless path", async () => {
    expect(await extractBlocksForFile("Makefile", "all:\n\techo hi")).toBeUndefined();
  });
});
