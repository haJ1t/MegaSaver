import { describe, expect, it } from "vitest";
import { blockTypeSchema, codeBlockSchema } from "../src/code-block.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const BLOCK_ID = "00000000-0000-4000-8000-0000000000aa";

function valid(over: Record<string, unknown> = {}): unknown {
  return {
    id: BLOCK_ID,
    projectId: PROJECT_ID,
    filePath: "src/auth.ts",
    startLine: 10,
    endLine: 25,
    blockType: "function",
    name: "validateToken",
    contentHash: "abc123",
    imports: ["jsonwebtoken"],
    exports: ["validateToken"],
    calls: ["verify"],
    calledBy: [],
    keywords: ["auth", "token"],
    ...over,
  };
}

describe("blockTypeSchema", () => {
  it("accepts every block type", () => {
    for (const t of [
      "function",
      "class",
      "component",
      "route",
      "test",
      "config",
      "schema",
      "docs",
    ]) {
      expect(blockTypeSchema.safeParse(t).success).toBe(true);
    }
  });
  it("rejects an unknown block type", () => {
    expect(blockTypeSchema.safeParse("module").success).toBe(false);
  });
});

describe("codeBlockSchema", () => {
  it("parses a well-formed block", () => {
    const parsed = codeBlockSchema.parse(valid());
    expect(parsed.blockType).toBe("function");
    expect(parsed.name).toBe("validateToken");
    expect(parsed.imports).toEqual(["jsonwebtoken"]);
  });

  it("rejects an uppercase id (lowercase-uuid contract)", () => {
    expect(codeBlockSchema.safeParse(valid({ id: BLOCK_ID.toUpperCase() })).success).toBe(false);
  });

  it("rejects a non-positive startLine", () => {
    expect(codeBlockSchema.safeParse(valid({ startLine: 0 })).success).toBe(false);
  });

  it("rejects endLine before startLine", () => {
    expect(codeBlockSchema.safeParse(valid({ startLine: 30, endLine: 10 })).success).toBe(false);
  });

  it("rejects unknown keys (.strict)", () => {
    expect(codeBlockSchema.safeParse({ ...(valid() as object), extra: 1 }).success).toBe(false);
  });

  it("allows optional name/summary/lastModifiedAt to be omitted", () => {
    const block = valid();
    // biome-ignore lint/performance/noDelete: test removes optional keys
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    delete (block as Record<string, unknown>)["name"];
    expect(codeBlockSchema.safeParse(block).success).toBe(true);
  });
});
