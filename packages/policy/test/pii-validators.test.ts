// packages/policy/test/pii-validators.test.ts
import { describe, expect, it } from "vitest";
import { ibanValid, luhnValid, tcknValid } from "../src/pii-validators.js";

describe("luhnValid", () => {
  it("accepts classic Luhn-valid test cards (16 and 15 digits)", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("378282246310005")).toBe(true);
  });
  it("rejects a checksum-broken card", () => {
    expect(luhnValid("4111111111111112")).toBe(false);
  });
  it("rejects out-of-range lengths (12 and 20 digits)", () => {
    expect(luhnValid("411111111111")).toBe(false);
    expect(luhnValid("41111111111111111111")).toBe(false);
  });
  it("accepts boundary lengths when Luhn-valid (13 and 19 digits)", () => {
    // 13-digit: 4222222222222 is a classic Visa 13-digit test number.
    expect(luhnValid("4222222222222")).toBe(true);
    // 19-digit: base 621234567890123283 + Luhn check digit 7 (digit sum 83 → c=7).
    expect(luhnValid("6212345678901232837")).toBe(true);
  });
});

describe("ibanValid", () => {
  it("accepts the ISO example and a TR sample", () => {
    expect(ibanValid("GB82WEST12345698765432")).toBe(true);
    expect(ibanValid("TR330006100519786457841326")).toBe(true);
  });
  it("rejects a mod-97-broken IBAN", () => {
    expect(ibanValid("GB82WEST12345698765431")).toBe(false);
  });
  it("rejects a malformed shape (too short / bad prefix)", () => {
    expect(ibanValid("GB82WEST1")).toBe(false);
    expect(ibanValid("8282WEST12345698765432")).toBe(false);
  });
});

describe("tcknValid", () => {
  it("accepts the canonical valid test id", () => {
    expect(tcknValid("10000000146")).toBe(true);
  });
  it("rejects a checksum-broken id", () => {
    expect(tcknValid("10000000147")).toBe(false);
  });
  it("rejects a leading zero and wrong lengths", () => {
    expect(tcknValid("01000000146")).toBe(false);
    expect(tcknValid("1000000014")).toBe(false);
    expect(tcknValid("100000001467")).toBe(false);
  });
});
