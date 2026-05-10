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
          "not_implemented",
          "mcp-bridge.start: real MCP server is deferred to v0.3+; v0.3 ships scaffold only.",
        ),
      );
    },
    stop() {
      return Promise.reject(
        new McpBridgeError(
          "not_implemented",
          "mcp-bridge.stop: real MCP server is deferred to v0.3+; v0.3 ships scaffold only.",
        ),
      );
    },
  };
}
