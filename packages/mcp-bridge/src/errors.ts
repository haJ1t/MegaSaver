import { z } from "zod";

// Order: alphabetic (AA1 §8b, §17). 16 members. The v0.3
// `not_implemented` member is removed — every entrypoint now has
// a real implementation (CLAUDE.md §13: no pre-1.0 shims).
// `resource_not_found` honours HH §7 reservation (F-MAJ-9);
// `path_denied` added per F-CRIT-2.
export const mcpBridgeErrorCodeSchema = z.enum([
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
]);

export type McpBridgeErrorCode = z.infer<typeof mcpBridgeErrorCodeSchema>;

export class McpBridgeError extends Error {
  readonly code: McpBridgeErrorCode;
  readonly details: { reason: string } | undefined;

  constructor(
    code: McpBridgeErrorCode,
    message: string,
    options?: { cause?: unknown; details?: { reason: string } },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "McpBridgeError";
    this.code = mcpBridgeErrorCodeSchema.parse(code);
    this.details = options?.details;
  }
}
