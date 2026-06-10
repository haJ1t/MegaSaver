import { describe, expect, it } from "vitest";
import { messageOf, redactedCount } from "../src/stats-helpers.js";

describe("redactedCount", () => {
  it("parses N from the filter's redaction warning", () => {
    expect(redactedCount(["redacted 2 secret(s) before processing"])).toBe(2);
  });

  it("returns 0 when no redaction warning is present", () => {
    expect(redactedCount(["terminated: timeout"])).toBe(0);
    expect(redactedCount([])).toBe(0);
  });
});

describe("messageOf", () => {
  it("extracts Error.message", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(messageOf("plain")).toBe("plain");
  });
});
