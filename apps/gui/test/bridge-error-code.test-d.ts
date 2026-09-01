import { describe, expectTypeOf, it } from "vitest";
import type { BRIDGE_ERROR_CODES, BridgeErrorCode } from "../src/bridge-error-code.js";

describe("BridgeErrorCode tuple ordering", () => {
  it("pins exhaustive alphabetic tuple", () => {
    expectTypeOf<typeof BRIDGE_ERROR_CODES>().toEqualTypeOf<
      readonly [
        "bad_recovery_code",
        "brain_sync_not_configured",
        "claude_session_not_found",
        "conditional_writes_unsupported",
        "config_invalid",
        "connector_write_failed",
        "decrypt_failed",
        "event_not_found",
        "hash_mismatch",
        "index_unavailable",
        "insecure_endpoint",
        "internal_error",
        "keyfile_invalid",
        "keyfile_missing",
        "manifest_invalid",
        "mcp_setup_failed",
        "memory_entry_not_found",
        "method_not_allowed",
        "object_missing",
        "office_not_configured",
        "office_not_found",
        "origin_forbidden",
        "payment_required",
        "policy_load_failed",
        "precondition_failed",
        "pro_required",
        "project_not_found",
        "rollback_detected",
        "rootpath_invalid",
        "route_not_found",
        "session_already_ended",
        "session_not_found",
        "session_project_mismatch",
        "store_write_failed",
        "sync_conflict",
        "transport_error",
        "unauthorized",
        "validation_failed",
        "wrong_key",
      ]
    >();
  });

  it("BridgeErrorCode is the union of the tuple members", () => {
    expectTypeOf<BridgeErrorCode>().toEqualTypeOf<
      | "bad_recovery_code"
      | "brain_sync_not_configured"
      | "claude_session_not_found"
      | "conditional_writes_unsupported"
      | "config_invalid"
      | "connector_write_failed"
      | "decrypt_failed"
      | "event_not_found"
      | "hash_mismatch"
      | "index_unavailable"
      | "insecure_endpoint"
      | "internal_error"
      | "keyfile_invalid"
      | "keyfile_missing"
      | "manifest_invalid"
      | "mcp_setup_failed"
      | "memory_entry_not_found"
      | "method_not_allowed"
      | "object_missing"
      | "office_not_configured"
      | "office_not_found"
      | "origin_forbidden"
      | "payment_required"
      | "policy_load_failed"
      | "precondition_failed"
      | "pro_required"
      | "project_not_found"
      | "rollback_detected"
      | "rootpath_invalid"
      | "route_not_found"
      | "session_already_ended"
      | "session_not_found"
      | "session_project_mismatch"
      | "store_write_failed"
      | "sync_conflict"
      | "transport_error"
      | "unauthorized"
      | "validation_failed"
      | "wrong_key"
    >();
  });
});
