import { z } from "zod";

export const connectorErrorCodeSchema = z.enum([
  "context_invalid",
  "block_conflict",
  "file_read_failed",
  "file_write_failed",
  "target_path_invalid",
]);
export type ConnectorErrorCode = z.infer<typeof connectorErrorCodeSchema>;

interface ConnectorErrorOptions {
  cause?: unknown;
  filePath?: string | null;
}

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly filePath: string | null;

  constructor(code: ConnectorErrorCode, message: string, options: ConnectorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ConnectorError";
    this.code = connectorErrorCodeSchema.parse(code);
    this.filePath = options.filePath ?? null;
  }
}
