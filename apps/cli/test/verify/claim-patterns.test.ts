import { describe, expect, it } from "vitest";
import { CLAIM_PATTERNS, scanClaims } from "../../src/commands/verify/claim-patterns.js";

describe("scanClaims — locked success-claim patterns", () => {
  const positives: ReadonlyArray<readonly [string, string]> = [
    ["All tests pass.", "tests-pass"],
    ["tests are passing now", "tests-pass"],
    ["everything is done, all green", "all-green"],
    ["all checks passed", "all-green"],
    ["the build succeeds on main", "build-succeeds"],
    ["Build is green after the fix", "build-succeeds"],
    ["the test suite is green", "suite-green"],
    ["suite passes locally", "suite-green"],
    ["pnpm verify passes", "verify-green"],
    ["lint is clean and typecheck passed", "lint-clean"],
  ];
  for (const [text, id] of positives) {
    it(`detects "${text}" as ${id}`, () => {
      expect(scanClaims(text).map((c) => c.patternId)).toContain(id);
    });
  }

  it("does not fire on failures or embedded words", () => {
    expect(scanClaims("tests fail on CI")).toEqual([]);
    expect(scanClaims("the password is rotated")).toEqual([]);
    expect(scanClaims("compass points north")).toEqual([]);
  });

  it("fires on claim-shaped text regardless of intent (documented, not fought)", () => {
    expect(
      scanClaims("we should make the tests pass eventually").map((c) => c.patternId),
    ).toContain("tests-pass");
  });

  it("returns claims sorted by index with a bounded single-line excerpt", () => {
    const text = `${"pad ".repeat(30)}tests pass\nand later the build succeeded`;
    const claims = scanClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims[0]?.index).toBeLessThan(claims[1]?.index ?? 0);
    for (const claim of claims) {
      expect(claim.excerpt.length).toBeLessThanOrEqual(80);
      expect(claim.excerpt).not.toContain("\n");
    }
  });

  it("locks the pattern-id list — additions must re-run the ReDoS guard suite", () => {
    expect(CLAIM_PATTERNS.map((p) => p.id)).toEqual([
      "tests-pass",
      "all-green",
      "build-succeeds",
      "suite-green",
      "verify-green",
      "lint-clean",
    ]);
  });
});
