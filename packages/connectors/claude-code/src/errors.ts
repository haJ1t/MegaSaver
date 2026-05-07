import { ConnectorError, type ConnectorErrorCode } from "@megasaver/connectors-shared";
import { z } from "zod";

export const claudeCodeConnectorErrorCodeSchema = z.enum([
  "claude_md_context_invalid",
  "claude_md_block_conflict",
  "claude_md_read_failed",
  "claude_md_write_failed",
  "project_root_invalid",
]);
export type ClaudeCodeConnectorErrorCode = z.infer<typeof claudeCodeConnectorErrorCodeSchema>;

interface ClaudeCodeConnectorErrorOptions {
  cause?: unknown;
  filePath?: string | null;
}

export class ClaudeCodeConnectorError extends Error {
  readonly code: ClaudeCodeConnectorErrorCode;
  readonly filePath: string | null;

  constructor(
    code: ClaudeCodeConnectorErrorCode,
    message: string,
    options: ClaudeCodeConnectorErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClaudeCodeConnectorError";
    this.code = claudeCodeConnectorErrorCodeSchema.parse(code);
    this.filePath = options.filePath ?? null;
  }
}

export function mapSharedErrorCode(code: ConnectorErrorCode): ClaudeCodeConnectorErrorCode {
  switch (code) {
    case "context_invalid":
      return "claude_md_context_invalid";
    case "block_conflict":
      return "claude_md_block_conflict";
    case "file_read_failed":
      return "claude_md_read_failed";
    case "file_write_failed":
      return "claude_md_write_failed";
    case "target_path_invalid":
      return "project_root_invalid";
  }
}

export function wrapSharedConnectorError(error: unknown, filePath: string | null): never {
  if (error instanceof ConnectorError) {
    throw new ClaudeCodeConnectorError(mapSharedErrorCode(error.code), error.message, {
      cause: error,
      filePath: filePath ?? error.filePath,
    });
  }
  throw error;
}
