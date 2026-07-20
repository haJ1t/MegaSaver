import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function filesBelow(root: string, extensions: ReadonlySet<string>): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesBelow(path, extensions);
    return entry.isFile() && extensions.has(extname(entry.name)) ? [path] : [];
  });
}

function lineCount(path: string): number {
  return readFileSync(path, "utf8").split("\n").length - 1;
}

describe("long-memory production source boundaries", () => {
  it("keeps every TypeScript production source at or below 300 lines", () => {
    const sourceRoot = join(import.meta.dirname, "../src");
    const oversized = filesBelow(sourceRoot, new Set([".ts"]))
      .map((path) => ({ path: path.slice(sourceRoot.length + 1), lines: lineCount(path) }))
      .filter(({ lines }) => lines > 300);

    expect(oversized).toEqual([]);
  });

  it("keeps benchmark production scripts at or below 300 lines", () => {
    const root = join(import.meta.dirname, "../../../benchmarks/longmemeval-v2");
    const production = filesBelow(root, new Set([".mjs", ".py"]))
      .filter((path) => !path.split("/").at(-1)?.startsWith("test_"))
      .filter((path) => !path.endsWith("lm2_test_support.py"));
    const oversized = production
      .map((path) => ({ path: path.slice(root.length + 1), lines: lineCount(path) }))
      .filter(({ lines }) => lines > 300);

    expect(oversized).toEqual([]);
  });
});
