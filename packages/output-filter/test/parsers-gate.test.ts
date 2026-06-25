import { describe, expect, it } from "vitest";
import { chunkByFormat, chunkByFormatWithMeta } from "../src/parsers/index.js";

describe("chunkByFormatWithMeta gating (T3)", () => {
  it("takes the semantic path for a supported file source", async () => {
    const text = [
      "export function a() {",
      "  return 1;",
      "}",
      "",
      "export function b() {",
      "  return 2;",
      "}",
    ].join("\n");
    const { chunks, semantic } = await chunkByFormatWithMeta(text, { kind: "file", path: "m.ts" });
    expect(semantic).toBe(true);
    expect(chunks.some((c) => c.text.includes("function a"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("function b"))).toBe(true);
  });

  it("falls back to line chunks for an unsupported file extension", async () => {
    const text = Array.from({ length: 5 }, (_, i) => `row ${i}`).join("\n");
    const { chunks, semantic } = await chunkByFormatWithMeta(text, {
      kind: "file",
      path: "data.csv",
    });
    expect(semantic).toBe(false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startLine).toBe(1);
  });

  it("falls back to line chunks when the extractor yields zero blocks", async () => {
    const { chunks, semantic } = await chunkByFormatWithMeta("just prose, no heading", {
      kind: "file",
      path: "x.md",
    });
    expect(semantic).toBe(false);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("never takes the semantic path for a command source", async () => {
    const text = Array.from({ length: 60 }, (_, i) => `log line ${i}`).join("\n");
    const { chunks, semantic } = await chunkByFormatWithMeta(text, {
      kind: "command",
      path: undefined,
    });
    expect(semantic).toBe(false);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("never takes the semantic path when source is undefined", async () => {
    const { semantic } = await chunkByFormatWithMeta("a\nb\nc", undefined);
    expect(semantic).toBe(false);
  });

  it("prefers the semantic path over format detectors for a .ts file that looks like a stacktrace", async () => {
    // body contains stack-trace-like text but must be parsed as source
    const text = [
      "export function f() {",
      "  // at Object.<anonymous> (/a/b.js:1:2)",
      "  return 0;",
      "}",
    ].join("\n");
    const { semantic } = await chunkByFormatWithMeta(text, { kind: "file", path: "trace.ts" });
    expect(semantic).toBe(true);
  });
});

describe("chunkByFormat back-compat wrapper (T3)", () => {
  it("returns the chunk array (no meta) unchanged for non-file input", async () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const chunks = await chunkByFormat(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.startLine).toBe(1);
  });
});
