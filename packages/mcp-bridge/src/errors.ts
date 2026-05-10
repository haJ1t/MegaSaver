import { z } from "zod";

// Order: alphabetic. v0.3 ships a single member; future codes
// (auth_failed, resource_not_found, tool_invocation_failed,
// tool_not_found, transport_closed, transport_failed) are reserved
// per spec §7 and append in alphabetic order.
export const mcpBridgeErrorCodeSchema = z.enum(["not_implemented"]);

export type McpBridgeErrorCode = z.infer<typeof mcpBridgeErrorCodeSchema>;

export class McpBridgeError extends Error {
  readonly code: McpBridgeErrorCode;

  constructor(code: McpBridgeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "McpBridgeError";
    this.code = mcpBridgeErrorCodeSchema.parse(code);
  }
}
