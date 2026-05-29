import { describe, expect, it } from "vitest";
import { collapseRepeatedLines, normalize } from "../src/normalize.js";

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
