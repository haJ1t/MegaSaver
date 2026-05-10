import { describe, it } from "vitest";
import { type TokenSaverMode, tokenSaverModeSchema } from "../src/token-saver-mode.js";

describe("TokenSaverMode type regression", () => {
  it("each AA1 member is a valid TokenSaverMode", () => {
    const _a: TokenSaverMode = "aggressive";
    const _b: TokenSaverMode = "balanced";
    const _c: TokenSaverMode = "safe";
    void _a;
    void _b;
    void _c;
  });

  it("non-member string literal is not assignable to TokenSaverMode", () => {
    // @ts-expect-error non-member literal is not TokenSaverMode
    const _bad: TokenSaverMode = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to TokenSaverMode", () => {
    // @ts-expect-error arbitrary string is not assignable to TokenSaverMode
    const _bad: TokenSaverMode = "extreme" as string;
    void _bad;
  });

  it("tokenSaverModeSchema.options spreads into TokenSaverMode[]", () => {
    const arr: TokenSaverMode[] = [...tokenSaverModeSchema.options];
    void arr;
  });

  it("tokenSaverModeSchema.options preserves alphabetic order", () => {
    const _t: readonly ["aggressive", "balanced", "safe"] = tokenSaverModeSchema.options;
    void _t;
  });
});
