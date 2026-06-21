import { z } from "zod";

export const agentOfficeErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
]);

export type AgentOfficeErrorCode = z.infer<typeof agentOfficeErrorCodeSchema>;

export class AgentOfficeError extends Error {
  readonly code: AgentOfficeErrorCode;

  constructor(code: AgentOfficeErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = "AgentOfficeError";
    this.code = code;
  }
}
