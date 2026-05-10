import { describe, it } from "vitest";
import { type McpBridgeErrorCode, mcpBridgeErrorCodeSchema } from "../src/errors.js";

describe("McpBridgeErrorCode type regression", () => {
  it("each v0.3 member is a valid McpBridgeErrorCode", () => {
    const _a: McpBridgeErrorCode = "not_implemented";
    void _a;
  });

  it("non-member string literal is not assignable to McpBridgeErrorCode", () => {
    // @ts-expect-error non-member literal is not McpBridgeErrorCode
    const _bad: McpBridgeErrorCode = "auth_failed";
    void _bad;
  });

  it("non-member string-cast is not assignable to McpBridgeErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable to McpBridgeErrorCode
    const _bad: McpBridgeErrorCode = "boom" as string;
    void _bad;
  });

  it("mcpBridgeErrorCodeSchema.options spreads into McpBridgeErrorCode[]", () => {
    const arr: McpBridgeErrorCode[] = [...mcpBridgeErrorCodeSchema.options];
    void arr;
  });

  it("mcpBridgeErrorCodeSchema.options preserves alphabetic order", () => {
    const _t: readonly ["not_implemented"] = mcpBridgeErrorCodeSchema.options;
    void _t;
  });
});
