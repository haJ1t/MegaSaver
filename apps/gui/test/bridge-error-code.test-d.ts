import { describe, expectTypeOf, it } from "vitest";
import type { BRIDGE_ERROR_CODES, BridgeErrorCode } from "../src/bridge-error-code.js";

describe("BridgeErrorCode tuple ordering", () => {
  it("pins exhaustive alphabetic tuple", () => {
    expectTypeOf<typeof BRIDGE_ERROR_CODES>().toEqualTypeOf<
      readonly [
        "internal_error",
        "method_not_allowed",
        "origin_forbidden",
        "project_not_found",
        "route_not_found",
        "session_already_ended",
        "session_not_found",
        "session_project_mismatch",
        "store_write_failed",
        "validation_failed",
      ]
    >();
  });

  it("BridgeErrorCode is the union of the tuple members", () => {
    expectTypeOf<BridgeErrorCode>().toEqualTypeOf<
      | "internal_error"
      | "method_not_allowed"
      | "origin_forbidden"
      | "project_not_found"
      | "route_not_found"
      | "session_already_ended"
      | "session_not_found"
      | "session_project_mismatch"
      | "store_write_failed"
      | "validation_failed"
    >();
  });
});
