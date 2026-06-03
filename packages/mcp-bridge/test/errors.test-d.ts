import { describe, it } from "vitest";
import { type McpBridgeErrorCode, mcpBridgeErrorCodeSchema } from "../src/errors.js";

describe("McpBridgeErrorCode type regression", () => {
  it("each member is a valid McpBridgeErrorCode", () => {
    const _a: McpBridgeErrorCode = "command_denied";
    const _b: McpBridgeErrorCode = "resource_not_found";
    const _c: McpBridgeErrorCode = "tool_not_found";
    void _a;
    void _b;
    void _c;
  });

  it("removed v0.3 member is no longer assignable", () => {
    // @ts-expect-error not_implemented was removed in BB8 (AA1 §8b)
    const _bad: McpBridgeErrorCode = "not_implemented";
    void _bad;
  });

  it("arbitrary string is not assignable to McpBridgeErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable
    const _bad: McpBridgeErrorCode = "boom" as string;
    void _bad;
  });

  it("schema.options spreads into McpBridgeErrorCode[]", () => {
    const arr: McpBridgeErrorCode[] = [...mcpBridgeErrorCodeSchema.options];
    void arr;
  });

  it("schema.options preserves the 16-member alphabetic order (AA1 §8b)", () => {
    const _t: readonly [
      "auth_failed",
      "command_denied",
      "content_store_miss",
      "intent_required",
      "max_bytes_exceeded",
      "path_denied",
      "policy_load_failed",
      "redaction_failed",
      "resource_not_found",
      "session_not_found",
      "store_write_failed",
      "tool_invocation_failed",
      "tool_not_found",
      "transport_closed",
      "transport_failed",
      "validation_failed",
    ] = mcpBridgeErrorCodeSchema.options;
    void _t;
  });
});
