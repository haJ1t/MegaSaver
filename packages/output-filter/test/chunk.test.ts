import { describe, expect, it } from "vitest";
import { chunkByLines } from "../src/chunk.js";

describe("chunkByLines (spec §6 stage 4 default)", () => {
  it("groups lines into chunks of the requested size", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkByLines(lines, 40);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(40);
    expect(chunks[1]?.startLine).toBe(41);
    expect(chunks[1]?.endLine).toBe(80);
  });

  it("keeps the final partial group", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkByLines(lines, 40);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.startLine).toBe(41);
    expect(chunks[1]?.endLine).toBe(50);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkByLines("", 40)).toEqual([]);
  });

  it("preserves the text of each chunk", () => {
    const chunks = chunkByLines("a\nb\nc", 2);
    expect(chunks[0]?.text).toBe("a\nb");
    expect(chunks[1]?.text).toBe("c");
  });
});
