import { describe, expect, it } from "vitest";
import { translateGitattributes } from "../src/gitattributes.js";

const RAW = [
  "# generated artifacts",
  "/src/gen/api.ts linguist-generated=true",
  "docs/generated/ linguist-generated",
  "*.pb.go linguist-generated",
  "legacy/[ab].ts linguist-generated",
  "!never.ts linguist-generated",
  "src/handwritten.ts -linguist-generated",
  "*.lock merge=binary",
  "",
].join("\n");

describe("translateGitattributes", () => {
  it("keeps linguist-generated (bare and =true), drops negated and unrelated attrs", () => {
    const out = translateGitattributes(RAW);
    expect(out.globs).toContain("src/gen/api.ts"); // leading / stripped → anchored
    expect(out.globs).toContain("docs/generated/**"); // bare dir → <p>/**
    expect(out.globs).toContain("**/*.pb.go"); // no slash → any depth (ASSUMPTION)
    expect(out.globs).not.toContain("src/handwritten.ts");
    expect(out.globs.some((g) => g.includes("merge"))).toBe(false);
  });
  it("reports bracket and negation patterns as skipped, never mis-fenced", () => {
    const out = translateGitattributes(RAW);
    expect(out.skipped).toEqual([
      { pattern: "legacy/[ab].ts", reason: "bracket expressions unsupported" },
      { pattern: "!never.ts", reason: "negation patterns unsupported" },
    ]);
    expect(out.globs.some((g) => g.includes("["))).toBe(false);
  });
  it("is total on junk input: comments, blank lines, lone words", () => {
    expect(translateGitattributes("# x\n\nword\n")).toEqual({
      globs: [],
      skipped: [],
    });
  });
});
