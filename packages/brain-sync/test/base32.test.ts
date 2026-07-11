import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "../src/base32.js";
import { BrainSyncError } from "../src/errors.js";

describe("base32 (RFC 4648, no padding)", () => {
  it("round-trips arbitrary bytes", () => {
    const input = Uint8Array.from({ length: 34 }, (_, i) => (i * 7 + 3) & 0xff);
    expect(base32Decode(base32Encode(input))).toEqual(input);
  });

  it("matches RFC 4648 test vectors", () => {
    const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
    expect(enc("f")).toBe("MY");
    expect(enc("fo")).toBe("MZXQ");
    expect(enc("foobar")).toBe("MZXW6YTBOI");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZX0")).toThrow(BrainSyncError); // 0 not in alphabet
  });

  it("round-trips empty input", () => {
    expect(base32Decode(base32Encode(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });
});
