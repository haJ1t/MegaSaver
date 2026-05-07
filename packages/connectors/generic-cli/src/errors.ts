import { ConnectorError, type ConnectorErrorCode } from "@megasaver/connectors-shared";
import { z } from "zod";

export const genericCliConnectorErrorCodeSchema = z.enum([
  "target_unknown",
  "context_invalid",
  "block_conflict",
  "file_read_failed",
  "file_write_failed",
  "project_root_invalid",
]);
export type GenericCliConnectorErrorCode = z.infer<typeof genericCliConnectorErrorCodeSchema>;

interface GenericCliConnectorErrorOptions {
  cause?: unknown;
  filePath?: string | null;
}

export class GenericCliConnectorError extends Error {
  readonly code: GenericCliConnectorErrorCode;
  readonly filePath: string | null;

  constructor(
    code: GenericCliConnectorErrorCode,
    message: string,
    options: GenericCliConnectorErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GenericCliConnectorError";
    this.code = genericCliConnectorErrorCodeSchema.parse(code);
    this.filePath = options.filePath ?? null;
  }
}

export function mapSharedErrorCode(code: ConnectorErrorCode): GenericCliConnectorErrorCode {
  switch (code) {
    case "context_invalid":
      return "context_invalid";
    case "block_conflict":
      return "block_conflict";
    case "file_read_failed":
      return "file_read_failed";
    case "file_write_failed":
      return "file_write_failed";
    case "target_path_invalid":
      return "project_root_invalid";
  }
}

export function wrapSharedConnectorError(error: unknown, filePath: string | null): never {
  if (error instanceof ConnectorError) {
    throw new GenericCliConnectorError(mapSharedErrorCode(error.code), error.message, {
      cause: error,
      filePath: filePath ?? error.filePath,
    });
  }
  throw error;
}
