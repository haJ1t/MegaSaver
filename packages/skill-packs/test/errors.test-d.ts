import { describe, it } from "vitest";
import { type SkillPackErrorCode, skillPackErrorCodeSchema } from "../src/errors.js";

describe("SkillPackErrorCode type regression", () => {
  it("each member is a valid SkillPackErrorCode", () => {
    const _all: SkillPackErrorCode[] = [
      "manifest_invalid",
      "manifest_missing",
      "pack_already_installed",
      "pack_not_found",
      "pack_path_escape",
      "pack_unreadable",
      "skill_id_conflict",
    ];
    void _all;
  });

  it("retired placeholder code is no longer assignable", () => {
    // @ts-expect-error not_implemented was removed with the real loader
    const _bad: SkillPackErrorCode = "not_implemented";
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
    const _t: readonly [
      "manifest_invalid",
      "manifest_missing",
      "pack_already_installed",
      "pack_not_found",
      "pack_path_escape",
      "pack_unreadable",
      "skill_id_conflict",
    ] = skillPackErrorCodeSchema.options;
    void _t;
  });
});
