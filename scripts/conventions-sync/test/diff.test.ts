import { describe, expect, it } from "vitest";
import { computeDiff } from "../src/diff.ts";

describe("computeDiff", () => {
  it("returns empty string when inputs match", () => {
    expect(computeDiff("hello\nworld", "hello\nworld", "x")).toBe("");
  });

  it("emits a unified-diff style header", () => {
    const out = computeDiff("a\nb\n", "a\nc\n", "file.md");
    expect(out).toContain("--- file.md (before)");
    expect(out).toContain("+++ file.md (after)");
  });

  it("marks changed lines with - and +", () => {
    const out = computeDiff("a\nb\nc\n", "a\nx\nc\n", "file.md");
    expect(out).toContain("-b");
    expect(out).toContain("+x");
  });
});
