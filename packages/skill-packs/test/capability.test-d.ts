import { describe, it } from "vitest";
import { type SkillPackCapability, skillPackCapabilitySchema } from "../src/capability.js";

describe("SkillPackCapability type regression", () => {
  it("each v0.3 member is a valid SkillPackCapability", () => {
    const _a: SkillPackCapability = "network";
    const _b: SkillPackCapability = "read-memory";
    const _c: SkillPackCapability = "write-memory";
    void _a;
    void _b;
    void _c;
  });

  it("non-member string literal is not assignable to SkillPackCapability", () => {
    // @ts-expect-error non-member literal is not SkillPackCapability
    const _bad: SkillPackCapability = "filesystem";
    void _bad;
  });

  it("non-member string-cast is not assignable to SkillPackCapability", () => {
    // @ts-expect-error arbitrary string is not assignable to SkillPackCapability
    const _bad: SkillPackCapability = "bogus" as string;
    void _bad;
  });

  it("skillPackCapabilitySchema.options spreads into SkillPackCapability[]", () => {
    const arr: SkillPackCapability[] = [...skillPackCapabilitySchema.options];
    void arr;
  });

  it("skillPackCapabilitySchema.options preserves alphabetic order", () => {
    const _t: readonly ["network", "read-memory", "write-memory"] =
      skillPackCapabilitySchema.options;
    void _t;
  });
});
