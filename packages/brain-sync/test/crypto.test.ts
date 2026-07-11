import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import { BrainSyncError } from "../src/errors.js";

const key = randomBytes(32);
const aad = "megasaver-brain-sync:v1:object:objects/x.enc";
const plaintext = new TextEncoder().encode("brain bundle text");

describe("crypto", () => {
  it("round-trips with matching AAD", () => {
    expect(decrypt(encrypt(plaintext, key, aad), key, aad)).toEqual(Buffer.from(plaintext));
  });

  it("uses a fresh IV per call (first 12 bytes differ)", () => {
    const a = encrypt(plaintext, key, aad).subarray(0, 12);
    const b = encrypt(plaintext, key, aad).subarray(0, 12);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const blob = encrypt(plaintext, key, aad);
    blob[13] = (blob[13] ?? 0) ^ 0xff;
    expect(() => decrypt(blob, key, aad)).toThrow(BrainSyncError);
  });

  it("rejects AAD mismatch (transplanted object name)", () => {
    const blob = encrypt(plaintext, key, aad);
    expect(() => decrypt(blob, key, "megasaver-brain-sync:v1:object:objects/other.enc")).toThrow(
      BrainSyncError,
    );
  });

  it("rejects the wrong key", () => {
    const blob = encrypt(plaintext, key, aad);
    expect(() => decrypt(blob, randomBytes(32), aad)).toThrow(BrainSyncError);
  });

  it("rejects blobs shorter than iv+tag", () => {
    expect(() => decrypt(new Uint8Array(10), key, aad)).toThrow(BrainSyncError);
  });
});
