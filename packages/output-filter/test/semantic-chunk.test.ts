// Proves the new cross-package dependency resolves through the output-filter
// package boundary. extractTs is re-exported from @megasaver/indexer's public
// entry (packages/indexer/src/index.ts). If the workspace dependency is not
// declared, this import fails to resolve and the test (and tsc) errors.
import { extractTs } from "@megasaver/indexer";
import { describe, expect, it } from "vitest";

describe("@megasaver/indexer dependency wiring (T1)", () => {
  it("resolves extractTs through the indexer public entry", () => {
    expect(typeof extractTs).toBe("function");
  });

  it("extractTs returns a block for a simple function declaration", () => {
    const blocks = extractTs(
      "foo.ts",
      "export function add(a: number, b: number) {\n  return a + b;\n}\n",
    );
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0]?.name).toBe("add");
    expect(blocks[0]?.startLine).toBe(1);
  });
});
