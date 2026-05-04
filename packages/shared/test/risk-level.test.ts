import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type RiskLevel, riskLevelSchema } from "../src/risk-level.js";

const members: ReadonlyArray<RiskLevel> = ["low", "medium", "high", "critical"];

describe("riskLevelSchema", () => {
  it("parses every enum member to itself", () => {
    for (const m of members) {
      expect(riskLevelSchema.parse(m)).toBe(m);
    }
  });

  it("rejects a known non-member with a ZodError", () => {
    const result = riskLevelSchema.safeParse("extreme");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("invalid_enum_value");
    }
  });

  it("property: any enum member is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom(...members), (m) => {
        expect(riskLevelSchema.parse(m)).toBe(m);
      }),
    );
  });

  it("property: any string outside the enum is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(members as readonly string[]).includes(s)),
        (s) => {
          expect(riskLevelSchema.safeParse(s).success).toBe(false);
        },
      ),
    );
  });
});
