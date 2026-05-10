import { describe, it } from "vitest";
import { type RiskLevel, riskLevelSchema } from "../src/risk-level.js";

describe("RiskLevel type regression", () => {
  it("each v0.1 member is a valid RiskLevel", () => {
    const _a: RiskLevel = "low";
    const _b: RiskLevel = "medium";
    const _c: RiskLevel = "high";
    const _d: RiskLevel = "critical";
    void _a;
    void _b;
    void _c;
    void _d;
  });

  it("non-member string literal is not assignable to RiskLevel", () => {
    // @ts-expect-error non-member literal is not RiskLevel
    const _bad: RiskLevel = "extreme";
    void _bad;
  });

  it("non-member string-cast is not assignable to RiskLevel", () => {
    // @ts-expect-error arbitrary string is not assignable to RiskLevel
    const _bad: RiskLevel = "bogus" as string;
    void _bad;
  });

  it("riskLevelSchema.options spreads into RiskLevel[]", () => {
    // Verifies that options elements are assignable to RiskLevel at the type level.
    const arr: RiskLevel[] = [...riskLevelSchema.options];
    void arr;
  });
});
