import { describe, it } from "vitest";
import { type SkillPackErrorCode, skillPackErrorCodeSchema } from "../src/errors.js";

describe("SkillPackErrorCode type regression", () => {
  it("each v0.3 member is a valid SkillPackErrorCode", () => {
    const _a: SkillPackErrorCode = "not_implemented";
    void _a;
  });

  it("non-member string literal is not assignable to SkillPackErrorCode", () => {
    // @ts-expect-error non-member literal is not SkillPackErrorCode
    const _bad: SkillPackErrorCode = "manifest_invalid";
    void _bad;
  });

  it("non-member string-cast is not assignable to SkillPackErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable to SkillPackErrorCode
    const _bad: SkillPackErrorCode = "boom" as string;
    void _bad;
  });

  it("skillPackErrorCodeSchema.options spreads into SkillPackErrorCode[]", () => {
    const arr: SkillPackErrorCode[] = [...skillPackErrorCodeSchema.options];
    void arr;
  });

  it("skillPackErrorCodeSchema.options preserves alphabetic order", () => {
    const _t: readonly ["not_implemented"] = skillPackErrorCodeSchema.options;
    void _t;
  });
});
