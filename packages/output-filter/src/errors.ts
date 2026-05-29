import { z } from "zod";

export const outputFilterErrorCodeSchema = z.enum(["path_unsafe", "validation_failed"]);

export type OutputFilterErrorCode = z.infer<typeof outputFilterErrorCodeSchema>;

export class OutputFilterError extends Error {
  readonly code: OutputFilterErrorCode;

  constructor(code: OutputFilterErrorCode, message?: string) {
    super(message ?? code);
    this.name = "OutputFilterError";
    this.code = code;
  }
}
