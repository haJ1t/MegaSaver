import { describe, expect, it } from "vitest";
import {
  canonicalFloat32,
  embeddingInputDigest,
  modelDescriptorFingerprint,
} from "../src/lm2-identity.js";

const model = {
  provider: "local",
  modelId: "mini",
  revision: "r1",
  dimensions: 3,
  embeddingInputVersion: "lm2-v1" as const,
};

describe("LM2 canonical identity", () => {
  it("uses a fixed key-sorted descriptor fingerprint", () => {
    expect(modelDescriptorFingerprint(model)).toBe(
      "e303c0e9c5360f3fe58af63efa085960b5b7bdc76061f703ff2c6df83d756e84",
    );
    expect(modelDescriptorFingerprint({ ...model })).toBe(modelDescriptorFingerprint(model));
  });

  it("strictly parses descriptors before canonicalizing independently ordered fields", () => {
    const reordered = {
      revision: "r1",
      dimensions: 3,
      embeddingInputVersion: "lm2-v1",
      provider: "local",
      modelId: "mini",
    };

    expect(modelDescriptorFingerprint(reordered as never)).toBe(modelDescriptorFingerprint(model));
    expect(() => modelDescriptorFingerprint({ ...model, unknown: true } as never)).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() => modelDescriptorFingerprint({ ...model, dimensions: 0 } as never)).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });

  it("binds canonical embedding input text and public kind", () => {
    expect(embeddingInputDigest({ kind: "state_snapshot", text: "Café paid" })).toBe(
      "6c7c437bdcbabc2aba2ac4dbb8e238b7052f657dfd48e4f17bc590a6951c51d7",
    );
    expect(() => embeddingInputDigest({ kind: "state_snapshot", text: " Cafe paid" })).toThrow();
  });

  it("strictly parses embedding identity inputs", () => {
    expect(() => embeddingInputDigest({ kind: "other", text: "Café paid" } as never)).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() =>
      embeddingInputDigest({ kind: "state_snapshot", text: "Café paid", unknown: true } as never),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects Float32 overflow, nonfinite values, and zero norm", () => {
    expect(() => canonicalFloat32([1e39, 0, 1])).toThrow(
      expect.objectContaining({ code: "invalid_vectors" }),
    );
    expect(() => canonicalFloat32([Number.NaN, 1])).toThrow(
      expect.objectContaining({ code: "invalid_vectors" }),
    );
    expect(() => canonicalFloat32([0, 0])).toThrow(
      expect.objectContaining({ code: "invalid_vectors" }),
    );
  });

  it("returns canonical Float32 vectors with an overflow-safe non-zero norm", () => {
    const vector = canonicalFloat32([3, 4]);

    expect(vector).toBeInstanceOf(Float32Array);
    expect([...vector]).toEqual([3, 4]);
    expect(canonicalFloat32([1e20, 1e20])).toBeInstanceOf(Float32Array);
  });
});
