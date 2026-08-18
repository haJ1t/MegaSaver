import { z } from "zod";

export const fenceErrorCodeSchema = z.enum(["schema_invalid", "io_failed"]);
export type FenceErrorCode = z.infer<typeof fenceErrorCodeSchema>;

export class FenceError extends Error {
  readonly code: FenceErrorCode;

  constructor(
    code: FenceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FenceError";
    this.code = code;
  }
}
