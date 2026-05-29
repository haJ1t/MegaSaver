import { describe, it } from "vitest";
import { type DerivedIntentSource, derivedIntentSourceSchema } from "../src/intent.js";

describe("DerivedIntentSource type regression", () => {
  it("each AA3 member is a valid DerivedIntentSource", () => {
    const _a: DerivedIntentSource = "auto";
    const _b: DerivedIntentSource = "command";
    const _c: DerivedIntentSource = "explicit";
    const _d: DerivedIntentSource = "file-path";
    const _e: DerivedIntentSource = "recent-memory";
    const _f: DerivedIntentSource = "session-title";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
  });

  it("non-member string literal is not assignable to DerivedIntentSource", () => {
    // @ts-expect-error non-member literal is not DerivedIntentSource
    const _bad: DerivedIntentSource = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to DerivedIntentSource", () => {
    // @ts-expect-error arbitrary string is not assignable to DerivedIntentSource
    const _bad: DerivedIntentSource = "bogus" as string;
    void _bad;
  });

  it("derivedIntentSourceSchema.options spreads into DerivedIntentSource[]", () => {
    const arr: DerivedIntentSource[] = [...derivedIntentSourceSchema.options];
    void arr;
  });

  it("derivedIntentSourceSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly [
      "auto",
      "command",
      "explicit",
      "file-path",
      "recent-memory",
      "session-title",
    ] = derivedIntentSourceSchema.options;
    void _t;
  });
});
