import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { McpBridge, McpBridgeConfig } from "@megasaver/mcp-bridge";
import { describe, expect, it } from "vitest";
import { runMcpServe } from "../../src/commands/mcp/serve.js";

describe("runMcpServe", () => {
  it("builds a stdio bridge with the resolved store + registry, starts then stops", async () => {
    const registry = createInMemoryCoreRegistry();
    const storeRoot = "/tmp/megasaver-serve-test";

    let captured: McpBridgeConfig | undefined;
    let started = 0;
    let stopped = 0;
    const fakeBridge: McpBridge = {
      transport: "stdio",
      start: async () => {
        started += 1;
      },
      stop: async () => {
        stopped += 1;
      },
    };

    const out: string[] = [];
    const code = await runMcpServe({
      resolveStore: async () => ({ storeRoot, registry }),
      createBridge: (config) => {
        captured = config;
        return fakeBridge;
      },
      // Resolves immediately so the unit test never attaches to real
      // stdin or installs signal handlers (no hang).
      waitForShutdown: async () => undefined,
      stderr: (l) => out.push(l),
    });

    expect(code).toBe(0);
    expect(captured).toMatchObject({ transport: "stdio", storeRoot });
    expect(captured?.registry).toBe(registry);
    expect(started).toBe(1);
    expect(stopped).toBe(1);
  });

  it("stops the bridge even when shutdown rejects, and returns exit 1", async () => {
    const registry = createInMemoryCoreRegistry();
    let stopped = 0;
    const fakeBridge: McpBridge = {
      transport: "stdio",
      start: async () => undefined,
      stop: async () => {
        stopped += 1;
      },
    };

    const code = await runMcpServe({
      resolveStore: async () => ({ storeRoot: "/tmp/x", registry }),
      createBridge: () => fakeBridge,
      waitForShutdown: async () => {
        throw new Error("transport crashed");
      },
      stderr: () => undefined,
    });

    expect(stopped).toBe(1);
    expect(code).toBe(1);
  });

  it("threads an injected transportFactory through to createBridge", async () => {
    const registry = createInMemoryCoreRegistry();
    let captured: McpBridgeConfig | undefined;
    const transportFactory = (() => ({})) as McpBridgeConfig["transportFactory"];
    const fakeBridge: McpBridge = {
      transport: "stdio",
      start: async () => undefined,
      stop: async () => undefined,
    };

    await runMcpServe({
      resolveStore: async () => ({ storeRoot: "/tmp/x", registry }),
      createBridge: (config) => {
        captured = config;
        return fakeBridge;
      },
      waitForShutdown: async () => undefined,
      transportFactory,
      stderr: () => undefined,
    });

    expect(captured?.transportFactory).toBe(transportFactory);
  });

  it("threads resolved Pro entitlement through to createBridge", async () => {
    const registry = createInMemoryCoreRegistry();
    let captured: McpBridgeConfig | undefined;
    const fakeBridge: McpBridge = {
      transport: "stdio",
      start: async () => undefined,
      stop: async () => undefined,
    };

    await runMcpServe({
      resolveStore: async () => ({ storeRoot: "/tmp/x", registry }),
      createBridge: (config) => {
        captured = config;
        return fakeBridge;
      },
      resolveIsPro: () => true,
      waitForShutdown: async () => undefined,
      stderr: () => undefined,
    });

    expect(captured?.isPro).toBe(true);
  });
});
