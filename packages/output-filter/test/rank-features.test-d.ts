import { describe, it } from "vitest";
import { type RankFeatureName, rankFeatureNameSchema } from "../src/rank-features.js";

describe("RankFeatureName type regression", () => {
  it("each member is a valid RankFeatureName", () => {
    const _a: RankFeatureName = "diagnosticScore";
    const _b: RankFeatureName = "duplicatePenalty";
    const _c: RankFeatureName = "errorScore";
    const _d: RankFeatureName = "filePathScore";
    const _e: RankFeatureName = "keywordScore";
    const _f: RankFeatureName = "noisePenalty";
    const _g: RankFeatureName = "recentFileScore";
    const _h: RankFeatureName = "stackTraceScore";
    const _i: RankFeatureName = "testFailureScore";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
    void _g;
    void _h;
    void _i;
  });

  it("non-member string literal is not assignable to RankFeatureName", () => {
    // @ts-expect-error non-member literal is not RankFeatureName
    const _bad: RankFeatureName = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to RankFeatureName", () => {
    // @ts-expect-error arbitrary string is not assignable to RankFeatureName
    const _bad: RankFeatureName = "bogus" as string;
    void _bad;
  });

  it("rankFeatureNameSchema.options spreads into RankFeatureName[]", () => {
    const arr: RankFeatureName[] = [...rankFeatureNameSchema.options];
    void arr;
  });

  it("rankFeatureNameSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly [
      "diagnosticScore",
      "duplicatePenalty",
      "errorScore",
      "filePathScore",
      "keywordScore",
      "noisePenalty",
      "recentFileScore",
      "stackTraceScore",
      "testFailureScore",
    ] = rankFeatureNameSchema.options;
    void _t;
  });
});
