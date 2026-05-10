import { describe, it } from "vitest";
import { type SkillPackKind, skillPackKindSchema } from "../src/kind.js";

describe("SkillPackKind type regression", () => {
  it("each v0.3 member is a valid SkillPackKind", () => {
    const _a: SkillPackKind = "prompt";
    const _b: SkillPackKind = "skill";
    const _c: SkillPackKind = "workflow";
    void _a;
    void _b;
    void _c;
  });

  it("non-member string literal is not assignable to SkillPackKind", () => {
    // @ts-expect-error non-member literal is not SkillPackKind
    const _bad: SkillPackKind = "agent";
    void _bad;
  });

  it("non-member string-cast is not assignable to SkillPackKind", () => {
    // @ts-expect-error arbitrary string is not assignable to SkillPackKind
    const _bad: SkillPackKind = "bogus" as string;
    void _bad;
  });

  it("skillPackKindSchema.options spreads into SkillPackKind[]", () => {
    const arr: SkillPackKind[] = [...skillPackKindSchema.options];
    void arr;
  });

  it("skillPackKindSchema.options preserves alphabetic order", () => {
    const _t: readonly ["prompt", "skill", "workflow"] = skillPackKindSchema.options;
    void _t;
  });
});
