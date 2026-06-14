import { describe, expect, it } from "vitest";
import { isSafeKeySegment, liveSessionIdSchema, workspaceKeySchema } from "../src/overlay-key.js";

describe("isSafeKeySegment", () => {
  it("rejects empty, slash, backslash, dot, dotdot, and NUL segments", () => {
    expect(isSafeKeySegment("")).toBe(false);
    expect(isSafeKeySegment("a/b")).toBe(false);
    expect(isSafeKeySegment("a\\b")).toBe(false);
    expect(isSafeKeySegment(".")).toBe(false);
    expect(isSafeKeySegment("..")).toBe(false);
    expect(isSafeKeySegment("x\0y")).toBe(false);
  });

  it("accepts a sha256-hex hash and a lowercase uuid", () => {
    expect(isSafeKeySegment("a".repeat(64))).toBe(true);
    expect(isSafeKeySegment("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isSafeKeySegment("0123456789abcdef")).toBe(true);
  });
});

describe("workspaceKeySchema", () => {
  it("rejects a traversal segment", () => {
    expect(() => workspaceKeySchema.parse("../etc")).toThrow();
  });

  it("accepts a safe segment", () => {
    expect(workspaceKeySchema.parse("0123456789abcdef")).toBe("0123456789abcdef");
  });
});

describe("liveSessionIdSchema", () => {
  it("rejects a traversal segment", () => {
    expect(() => liveSessionIdSchema.parse("..")).toThrow();
  });

  it("accepts a lowercase uuid", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(liveSessionIdSchema.parse(id)).toBe(id);
  });
});
