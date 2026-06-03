import { describe, expect, it } from "vitest";
import { createBridge } from "../src/bridge.js";
import { McpBridgeError } from "../src/errors.js";

describe("createBridge — v0.3 placeholder surface", () => {
  it("exposes the parsed transport", () => {
    const bridge = createBridge({ transport: "stdio" });
    expect(bridge.transport).toBe("stdio");
  });

  it("rejects unknown transport at the boundary", () => {
    expect(() => createBridge({ transport: "websocket" as unknown as "stdio" })).toThrow();
  });

  it("start() rejects with McpBridgeError(transport_failed)", async () => {
    const bridge = createBridge({ transport: "stdio" });
    await expect(bridge.start()).rejects.toMatchObject({
      name: "McpBridgeError",
      code: "transport_failed",
    });
  });

  it("stop() rejects with McpBridgeError(not_implemented)", async () => {
    const bridge = createBridge({ transport: "sse" });
    await expect(bridge.stop()).rejects.toBeInstanceOf(McpBridgeError);
  });
});
