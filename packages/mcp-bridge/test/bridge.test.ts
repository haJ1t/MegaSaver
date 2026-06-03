import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { createBridge } from "../src/bridge.js";

function bridgeConfig(transport: "stdio" | "sse") {
  return {
    transport,
    storeRoot: "/tmp/megasaver-bridge-test",
    registry: createInMemoryCoreRegistry(),
  };
}

describe("createBridge — real surface (BB8)", () => {
  it("exposes the parsed transport (API preserved, AA1 §2c)", () => {
    const bridge = createBridge(bridgeConfig("stdio"));
    expect(bridge.transport).toBe("stdio");
  });

  it("rejects an unknown transport at the boundary", () => {
    expect(() =>
      createBridge({
        transport: "websocket" as unknown as "stdio",
        storeRoot: "/tmp/x",
        registry: createInMemoryCoreRegistry(),
      }),
    ).toThrow();
  });

  it("start()/stop() are idempotent and resolve void for stdio", async () => {
    const bridge = createBridge(bridgeConfig("stdio"));
    await expect(bridge.start()).resolves.toBeUndefined();
    await expect(bridge.start()).resolves.toBeUndefined(); // idempotent (HH §6)
    await expect(bridge.stop()).resolves.toBeUndefined();
    await expect(bridge.stop()).resolves.toBeUndefined(); // idempotent
  });

  it("start() rejects transport_failed for sse (AA1 §8c)", async () => {
    const bridge = createBridge(bridgeConfig("sse"));
    await expect(bridge.start()).rejects.toMatchObject({
      name: "McpBridgeError",
      code: "transport_failed",
    });
  });
});
