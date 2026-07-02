import { describe, expect, it } from "vitest";
import { repositoryFamilyKeySchema } from "../src/repository-family-key.js";

// 43 base64url chars = SHA-256 (32 bytes) with no padding.
const VALID = `gf1_${"A".repeat(43)}`;

describe("repositoryFamilyKeySchema", () => {
  it("accepts a gf1_ prefix + 43 base64url chars", () => {
    expect(repositoryFamilyKeySchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts the full base64url alphabet (letters, digits, - and _)", () => {
    // gf1_ + exactly 43 base64url chars covering A-Z a-z 0-9 - _
    expect(
      repositoryFamilyKeySchema.safeParse("gf1_abcABC012-_01234567890123456789012345678901")
        .success,
    ).toBe(true);
  });

  it("rejects the wrong prefix", () => {
    expect(repositoryFamilyKeySchema.safeParse(`wk1_${"A".repeat(43)}`).success).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(repositoryFamilyKeySchema.safeParse(`gf1_${"A".repeat(42)}`).success).toBe(false);
    expect(repositoryFamilyKeySchema.safeParse(`gf1_${"A".repeat(44)}`).success).toBe(false);
  });

  it("rejects non-base64url chars (+, /, =)", () => {
    expect(repositoryFamilyKeySchema.safeParse(`gf1_${"+".repeat(43)}`).success).toBe(false);
    expect(repositoryFamilyKeySchema.safeParse(`gf1_${"/".repeat(43)}`).success).toBe(false);
    expect(repositoryFamilyKeySchema.safeParse(`gf1_${"=".repeat(43)}`).success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(repositoryFamilyKeySchema.safeParse("").success).toBe(false);
  });
});
