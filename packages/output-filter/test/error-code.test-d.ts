import { describe, it } from "vitest";
import { type OutputFilterErrorCode, outputFilterErrorCodeSchema } from "../src/errors.js";

describe("OutputFilterErrorCode type regression", () => {
  it("each member is a valid OutputFilterErrorCode", () => {
    const _a: OutputFilterErrorCode = "path_unsafe";
    const _b: OutputFilterErrorCode = "validation_failed";
    void _a;
    void _b;
  });

  it("non-member string literal is not assignable to OutputFilterErrorCode", () => {
    // @ts-expect-error non-member literal is not OutputFilterErrorCode
    const _bad: OutputFilterErrorCode = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to OutputFilterErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable to OutputFilterErrorCode
    const _bad: OutputFilterErrorCode = "bogus" as string;
    void _bad;
  });

  it("outputFilterErrorCodeSchema.options spreads into OutputFilterErrorCode[]", () => {
    const arr: OutputFilterErrorCode[] = [...outputFilterErrorCodeSchema.options];
    void arr;
  });

  it("outputFilterErrorCodeSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly ["path_unsafe", "validation_failed"] = outputFilterErrorCodeSchema.options;
    void _t;
  });
});
