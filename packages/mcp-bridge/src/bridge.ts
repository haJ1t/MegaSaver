import type { CoreRegistry } from "@megasaver/core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { McpBridgeError } from "./errors.js";
import { buildServer } from "./server.js";
import { type McpTransport, mcpTransportSchema } from "./transport.js";

const mcpBridgeConfigSchema = z.object({
  transport: mcpTransportSchema,
  storeRoot: z.string().min(1),
});

export type McpBridgeConfig = z.infer<typeof mcpBridgeConfigSchema> & {
  // DI slots (AA1 §2c). Not part of the Zod-validated shape — the
  // registry is an object instance, validated by construction.
  registry: CoreRegistry;
  now?: () => string;
  newId?: () => string;
  // Entitlement resolved CLI-side (mega mcp serve); the bridge keeps zero
  // entitlement deps and just threads the resolved flag to buildServer.
  isPro?: boolean;
  // Injectable transport (CRITICAL §12): production defaults to a
  // real StdioServerTransport; tests pass a no-op.
  transportFactory?: () => StdioServerTransport;
};

export type McpBridge = {
  readonly transport: McpTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createBridge(config: McpBridgeConfig): McpBridge {
  const parsed = mcpBridgeConfigSchema.parse({
    transport: config.transport,
    storeRoot: config.storeRoot,
  });

  let server: Server | undefined;
  let transport: StdioServerTransport | undefined;
  let running = false;

  return {
    transport: parsed.transport,
    async start() {
      if (parsed.transport === "sse") {
        throw new McpBridgeError(
          "transport_failed",
          "sse transport is reserved for v0.6+; only stdio is implemented (AA1 §8c)",
        );
      }
      if (running) return; // idempotent (HH §6)
      const built = buildServer({
        registry: config.registry,
        storeRoot: config.storeRoot,
        ...(config.isPro !== undefined ? { isPro: config.isPro } : {}),
        ...(config.now !== undefined ? { now: config.now } : {}),
        ...(config.newId !== undefined ? { newId: config.newId } : {}),
        ...(config.transportFactory !== undefined
          ? { transportFactory: config.transportFactory }
          : {}),
      });
      server = built.server;
      transport = built.transport;
      await server.connect(transport);
      running = true;
    },
    async stop() {
      if (!running) return; // idempotent
      await server?.close();
      server = undefined;
      transport = undefined;
      running = false;
    },
  };
}
