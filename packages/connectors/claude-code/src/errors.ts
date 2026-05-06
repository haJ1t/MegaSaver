import { z } from "zod";

export const claudeCodeConnectorErrorCodeSchema = z.enum([
  "claude_md_context_invalid",
  "claude_md_block_conflict",
  "claude_md_read_failed",
  "claude_md_write_failed",
  "project_root_invalid",
]);

export type ClaudeCodeConnectorErrorCode = z.infer<
  typeof claudeCodeConnectorErrorCodeSchema
>;

export interface ClaudeCodeConnectorErrorOptions {
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
