import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalSha256,
  deriveBenchmarkProjectionId,
  truncateUtf16,
} from "../src/lm2-benchmark-canonical.js";

describe("LM2 benchmark canonical values", () => {
  it("matches the required canonical JSON test vector", () => {
    const bytes = canonicalJson({ b: "e\u0301", a: [true, 1] });

    expect(bytes).toBe('{"a":[true,1],"b":"é"}');
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "58c663564b7cee5fa1477a1cc371a0426bc5f6fb98fc493cdf0d51ab8066ec52",
    );
  });

  it("normalizes every string and orders keys by Unicode code point", () => {
    expect(canonicalJson({ "\u{10000}": "e\u0301", "\ue000": "x" })).toBe('{"":"x","𐀀":"é"}');
  });

  it("rejects non-JSON and non-finite values", () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ value: undefined })).toThrow();
    expect(() => canonicalJson({ value: 1n })).toThrow();
  });

  it("derives framed lowercase UUIDv5 projection ids", () => {
    expect(deriveBenchmarkProjectionId("trajectory-1", "states", 2)).toBe(
      "32f31c63-ec59-5f18-bcb6-bb6320e2d6f7",
    );
    expect(deriveBenchmarkProjectionId("trajectory-1\0states", "", 2)).not.toBe(
      deriveBenchmarkProjectionId("trajectory-1", "states", 2),
    );
  });

  it("truncates to UTF-16 units without an unpaired surrogate", () => {
    expect(truncateUtf16(`${"a".repeat(49_999)}😀`, 50_000)).toBe("a".repeat(49_999));
    expect(truncateUtf16(`${"a".repeat(49_998)}😀`, 50_000)).toBe(`${"a".repeat(49_998)}😀`);
  });

  it("hashes canonical values rather than host object order", () => {
    expect(canonicalSha256({ b: 2, a: 1 })).toBe(canonicalSha256({ a: 1, b: 2 }));
  });
});
