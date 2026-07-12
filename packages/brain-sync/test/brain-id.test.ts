import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveBrainId } from "../src/brain-id.js";

const key = randomBytes(32);

describe("deriveBrainId", () => {
  it("is deterministic for the same key + name", () => {
    expect(deriveBrainId(key, "alpha")).toBe(deriveBrainId(key, "alpha"));
  });

  it("differs for different project names under the same key", () => {
    expect(deriveBrainId(key, "alpha")).not.toBe(deriveBrainId(key, "beta"));
  });

  it("differs for the same name under a different key", () => {
    expect(deriveBrainId(key, "alpha")).not.toBe(deriveBrainId(randomBytes(32), "alpha"));
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(deriveBrainId(key, "Alpha ")).toBe(deriveBrainId(key, "alpha"));
  });

  it("returns 64 lowercase hex chars", () => {
    expect(deriveBrainId(key, "alpha")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("NFC-normalizes so precomposed and decomposed names derive the same id", () => {
    // "café": precomposed (…f + U+00E9) vs decomposed (…fe + U+0301) look
    // identical but are different code points — without NFC they'd fork.
    const precomposed = "café";
    const decomposed = "café";
    expect(precomposed).not.toBe(decomposed);
    expect(deriveBrainId(key, precomposed)).toBe(deriveBrainId(key, decomposed));
  });
});
