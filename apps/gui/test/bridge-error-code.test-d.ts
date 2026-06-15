import { describe, expectTypeOf, it } from "vitest";
import type { BRIDGE_ERROR_CODES, BridgeErrorCode } from "../src/bridge-error-code.js";

describe("BridgeErrorCode tuple ordering", () => {
  it("pins exhaustive alphabetic tuple", () => {
    expectTypeOf<typeof BRIDGE_ERROR_CODES>().toEqualTypeOf<
      readonly [
        "claude_session_not_found",
        "connector_write_failed",
        "event_not_found",
        "index_unavailable",
        "internal_error",
        "mcp_setup_failed",
        "memory_entry_not_found",
        "method_not_allowed",
        "origin_forbidden",
        "policy_load_failed",
        "project_not_found",
        "rootpath_invalid",
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
      | "claude_session_not_found"
      | "connector_write_failed"
      | "event_not_found"
      | "index_unavailable"
      | "internal_error"
      | "mcp_setup_failed"
      | "memory_entry_not_found"
      | "method_not_allowed"
      | "origin_forbidden"
      | "policy_load_failed"
      | "project_not_found"
      | "rootpath_invalid"
      | "route_not_found"
      | "session_already_ended"
      | "session_not_found"
      | "session_project_mismatch"
      | "store_write_failed"
      | "validation_failed"
    >();
  });
});
