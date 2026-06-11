import { describe, expect, it } from "vitest";
import { extractJson } from "../src/extract/extract-json.js";
import { extractMd } from "../src/extract/extract-md.js";

describe("extractMd", () => {
  const MD = `# Title

Intro paragraph.

## Section A

Body of A.

## Section B

Body of B.
`;
  const blocks = extractMd("README.md", MD);

  it("splits on ATX headings into docs blocks named by heading", () => {
    expect(blocks.map((b) => b.name)).toEqual(["Title", "Section A", "Section B"]);
    expect(blocks.every((b) => b.blockType === "docs")).toBe(true);
  });

  it("captures heading line numbers and a content hash", () => {
    const a = blocks.find((b) => b.name === "Section A");
    expect(a?.startLine).toBe(5);
    expect((a?.contentHash ?? "").length).toBeGreaterThan(0);
    expect(a?.endLine).toBeGreaterThanOrEqual(a?.startLine ?? 0);
  });

  it("returns no blocks for heading-less markdown", () => {
    expect(extractMd("x.md", "just prose, no headings\n")).toEqual([]);
  });
});

describe("extractJson", () => {
  it("emits a config block per top-level key", () => {
    const blocks = extractJson("config.json", '{\n  "host": "localhost",\n  "port": 5432\n}\n');
    expect(blocks.map((b) => b.name).sort()).toEqual(["host", "port"]);
    expect(blocks.every((b) => b.blockType === "config")).toBe(true);
  });

  it("expands package.json scripts into script:<name> blocks", () => {
    const pkg =
      '{\n  "name": "demo",\n  "scripts": {\n    "build": "tsup",\n    "test": "vitest"\n  }\n}\n';
    const names = extractJson("package.json", pkg).map((b) => b.name);
    expect(names).toContain("name");
    expect(names).toContain("script:build");
    expect(names).toContain("script:test");
  });

  it("returns no blocks for invalid JSON", () => {
    expect(extractJson("bad.json", "{ not valid")).toEqual([]);
  });

  it("locates a top-level key at its own line, not a nested/value occurrence", () => {
    const json = '{\n  "x": 1,\n  "nested": {\n    "x": 2\n  }\n}\n';
    const x = extractJson("c.json", json).find((b) => b.name === "x");
    expect(x?.startLine).toBe(2);
  });
});
