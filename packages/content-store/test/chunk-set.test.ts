import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chunkSetSchema } from "../src/chunk-set.js";

function validChunkSet(redacted: boolean): unknown {
  return {
    chunkSetId: "cs-1",
    sessionId: randomUUID(),
    projectId: randomUUID(),
    createdAt: "2026-05-10T12:00:00.000Z",
    source: { kind: "command", command: "ls", args: ["-la"] },
    rawBytes: 128,
    redacted,
    chunks: [{ id: "c1", startLine: 1, endLine: 4, bytes: 32, text: "hello" }],
  };
}

describe("chunkSetSchema validation", () => {
  it("accepts a valid chunkSet", () => {
    expect(() => chunkSetSchema.parse(validChunkSet(false))).not.toThrow();
  });

  it("rejects extra keys (.strict)", () => {
    const withExtra = { ...(validChunkSet(false) as Record<string, unknown>), extra: 1 };
    expect(() => chunkSetSchema.parse(withExtra)).toThrow();
  });

  it("rejects negative rawBytes", () => {
    const bad = { ...(validChunkSet(false) as Record<string, unknown>), rawBytes: -1 };
    expect(() => chunkSetSchema.parse(bad)).toThrow();
  });

  it("rejects a chunk with negative startLine", () => {
    const bad = {
      ...(validChunkSet(false) as Record<string, unknown>),
      chunks: [{ id: "c1", startLine: -1, endLine: 4, bytes: 32, text: "x" }],
    };
    expect(() => chunkSetSchema.parse(bad)).toThrow();
  });

  it("rejects a chunk with negative bytes", () => {
    const bad = {
      ...(validChunkSet(false) as Record<string, unknown>),
      chunks: [{ id: "c1", startLine: 1, endLine: 4, bytes: -1, text: "x" }],
    };
    expect(() => chunkSetSchema.parse(bad)).toThrow();
  });

  it("rejects a non-uuid projectId", () => {
    const bad = { ...(validChunkSet(false) as Record<string, unknown>), projectId: "not-a-uuid" };
    expect(() => chunkSetSchema.parse(bad)).toThrow();
  });

  it("requires redacted to be a boolean", () => {
    const bad = { ...(validChunkSet(false) as Record<string, unknown>), redacted: "no" };
    expect(() => chunkSetSchema.parse(bad)).toThrow();
  });

  it("rejects an unknown source kind", () => {
    const bad = {
      ...(validChunkSet(false) as Record<string, unknown>),
      source: { kind: "socket", addr: "x" },
    };
    expect(() => chunkSetSchema.parse(bad)).toThrow();
  });

  it("preserves redacted=true through parse -> serialize -> parse", () => {
    const once = chunkSetSchema.parse(validChunkSet(true));
    const twice = chunkSetSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice.redacted).toBe(true);
  });

  it("preserves redacted=false through parse -> serialize -> parse", () => {
    const once = chunkSetSchema.parse(validChunkSet(false));
    const twice = chunkSetSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(twice.redacted).toBe(false);
  });
});
