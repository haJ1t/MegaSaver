import { describe, expect, it } from "vitest";
import { collapseRepeatedLines, collapseSimilar, normalize } from "../src/normalize.js";

describe("normalize (spec §6 stage 2)", () => {
  it("strips ANSI SGR color escape sequences", () => {
    expect(normalize("[31merror[0m")).toBe("error");
  });

  it("collapses CRLF to LF", () => {
    expect(normalize("a\r\nb")).toBe("a\nb");
  });

  it("collapses lone CR to LF", () => {
    expect(normalize("a\rb")).toBe("a\nb");
  });

  it("trims trailing whitespace per line", () => {
    expect(normalize("a   \nb\t")).toBe("a\nb");
  });

  it("leaves clean text unchanged", () => {
    expect(normalize("hello\nworld")).toBe("hello\nworld");
  });
});

describe("collapseRepeatedLines (spec §6 stage 3)", () => {
  it("collapses N>=2 consecutive identical lines into one + marker", () => {
    expect(collapseRepeatedLines("x\nx\nx")).toBe("x\n… [repeated 3 times]");
  });

  it("does not collapse a single occurrence", () => {
    expect(collapseRepeatedLines("x\ny")).toBe("x\ny");
  });

  it("collapses two identical lines", () => {
    expect(collapseRepeatedLines("x\nx")).toBe("x\n… [repeated 2 times]");
  });

  it("only collapses consecutive duplicates", () => {
    expect(collapseRepeatedLines("x\ny\nx")).toBe("x\ny\nx");
  });
});

describe("collapseSimilar (template-line folding)", () => {
  it("folds timestamp-only-varying lines to one exemplar keeping first AND last", () => {
    const input = [
      "2026-06-29T10:00:01Z GET /health 200",
      "2026-06-29T10:00:02Z GET /health 200",
      "2026-06-29T10:00:03Z GET /health 200",
      "2026-06-29T10:00:04Z GET /health 200",
    ].join("\n");
    const out = collapseSimilar(input);
    const lines = out.split("\n");
    expect(lines[0]).toBe("2026-06-29T10:00:01Z GET /health 200");
    expect(lines).toContain("2026-06-29T10:00:04Z GET /health 200");
    expect(out).toMatch(/\[2 similar:/);
    expect(lines.length).toBe(3);
  });

  it("does NOT fold two distinct error lines (evidence guard)", () => {
    const input = [
      "2026-06-29T10:00:01Z ERROR connection refused on port 5432",
      "2026-06-29T10:00:02Z ERROR connection refused on port 5433",
    ].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("does not fold lines differing in meaningful content", () => {
    const input = [
      "worker started handling queue alpha",
      "worker started handling queue beta",
    ].join("\n");
    expect(collapseSimilar(input)).toBe(input);
  });

  it("leaves a single line untouched", () => {
    expect(collapseSimilar("2026-06-29T10:00:01Z GET /health 200")).toBe(
      "2026-06-29T10:00:01Z GET /health 200",
    );
  });

  it("is a no-op on already-unique text", () => {
    const input = "alpha\nbeta\ngamma";
    expect(collapseSimilar(input)).toBe(input);
  });
});
