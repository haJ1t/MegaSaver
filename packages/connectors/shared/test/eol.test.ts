import { describe, expect, it } from "vitest";
import { normalizeEol } from "../src/eol.js";

describe("normalizeEol", () => {
  it("collapses CRLF to LF", () => {
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
  });
  it("leaves LF untouched", () => {
    expect(normalizeEol("a\nb\n")).toBe("a\nb\n");
  });
  it("normalizes mixed endings to LF", () => {
    expect(normalizeEol("a\r\nb\nc")).toBe("a\nb\nc");
  });
  it("does not touch a lone CR (classic-Mac, out of scope)", () => {
    expect(normalizeEol("a\rb")).toBe("a\rb");
  });
});
