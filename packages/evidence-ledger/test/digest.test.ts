import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { digestContent } from "../src/digest.js";

describe("digestContent", () => {
  it("produces lowercase sha256 hex over the given post-redaction text", () => {
    const text = "redacted output";
    expect(digestContent(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(digestContent(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(digestContent("x")).toBe(digestContent("x"));
  });
});
