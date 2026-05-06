export type ClaudeCodeConnectorErrorCode =
  | "claude_md_context_invalid"
  | "claude_md_block_conflict"
  | "claude_md_read_failed"
  | "claude_md_write_failed"
  | "project_root_invalid";

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
    super(message, { cause: options.cause });
    this.name = "ClaudeCodeConnectorError";
    this.code = code;
    this.filePath = options.filePath ?? null;
  }
}
