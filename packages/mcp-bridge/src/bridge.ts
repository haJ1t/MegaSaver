import { z } from "zod";
import { McpBridgeError } from "./errors.js";
import { type McpTransport, mcpTransportSchema } from "./transport.js";

const mcpBridgeConfigSchema = z.object({
  transport: mcpTransportSchema,
});

export type McpBridgeConfig = z.infer<typeof mcpBridgeConfigSchema>;

export type McpBridge = {
  readonly transport: McpTransport;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createBridge(config: McpBridgeConfig): McpBridge {
  const parsed = mcpBridgeConfigSchema.parse(config);
  return {
    transport: parsed.transport,
    start() {
      return Promise.reject(
        new McpBridgeError(
          "transport_failed",
          "mcp-bridge.start: real MCP server lands in BB8 Task 6 (server wiring).",
        ),
      );
    },
    stop() {
      return Promise.reject(
        new McpBridgeError(
          "transport_failed",
          "mcp-bridge.stop: real MCP server lands in BB8 Task 6 (server wiring).",
        ),
      );
    },
  };
}
