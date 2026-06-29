import { describe, expect, it } from "vitest";
import { cosine } from "../src/cosine.js";

describe("cosine", () => {
  it("identical vectors → 1", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosine(v, new Float32Array([1, 2, 3]))).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it("opposite vectors → -1", () => {
    expect(cosine(new Float32Array([1, 2]), new Float32Array([-1, -2]))).toBeCloseTo(-1, 6);
  });

  it("is scale-invariant", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([2, 4, 6]);
    expect(cosine(a, b)).toBeCloseTo(1, 6);
  });

  it("zero-norm input → 0 (no NaN)", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(cosine(new Float32Array([0, 0]), new Float32Array([0, 0]))).toBe(0);
  });
});
