import { z } from "zod";

export const lm2ErrorCodeSchema = z.enum([
  "invalid_input",
  "invalid_vectors",
  "invalid_config",
  "candidate_store_invalid",
  "index_busy",
  "index_lock_unavailable",
  "cursor_expired",
  "store_corrupt",
  "write_failed",
]);
export type Lm2ErrorCode = z.infer<typeof lm2ErrorCodeSchema>;

export class Lm2Error extends Error {
  readonly code: Lm2ErrorCode;

  constructor(code: Lm2ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Lm2Error";
    this.code = code;
  }
}
