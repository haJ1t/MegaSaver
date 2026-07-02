import { describe, expect, it } from "vitest";
import { ContentStoreError, assertSafeSegment } from "../src/index.js";

describe("assertSafeSegment public export", () => {
  it("is exported from the package entry and rejects traversal segments", () => {
    expect(typeof assertSafeSegment).toBe("function");
    for (const bad of ["", ".", "..", "a/b", "a\\b"]) {
      expect(() => assertSafeSegment(bad)).toThrow(ContentStoreError);
    }
    expect(() => assertSafeSegment("ok-segment")).not.toThrow();
  });
});
