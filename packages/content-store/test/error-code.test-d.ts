import { describe, it } from "vitest";
import { type ContentStoreErrorCode, contentStoreErrorCodeSchema } from "../src/errors.js";

describe("ContentStoreErrorCode type regression", () => {
  it("each member is a valid ContentStoreErrorCode", () => {
    const _a: ContentStoreErrorCode = "not_found";
    const _b: ContentStoreErrorCode = "schema_invalid";
    const _c: ContentStoreErrorCode = "store_corrupt";
    const _d: ContentStoreErrorCode = "write_failed";
    void _a;
    void _b;
    void _c;
    void _d;
  });

  it("non-member string literal is not assignable to ContentStoreErrorCode", () => {
    // @ts-expect-error non-member literal is not ContentStoreErrorCode
    const _bad: ContentStoreErrorCode = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to ContentStoreErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable to ContentStoreErrorCode
    const _bad: ContentStoreErrorCode = "bogus" as string;
    void _bad;
  });

  it("contentStoreErrorCodeSchema.options spreads into ContentStoreErrorCode[]", () => {
    const arr: ContentStoreErrorCode[] = [...contentStoreErrorCodeSchema.options];
    void arr;
  });

  it("contentStoreErrorCodeSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly ["not_found", "schema_invalid", "store_corrupt", "write_failed"] =
      contentStoreErrorCodeSchema.options;
    void _t;
  });
});
