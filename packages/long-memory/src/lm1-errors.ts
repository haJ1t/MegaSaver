import { z } from "zod";

export const lm1ErrorCodeSchema = z.enum([
  "invalid_input",
  "evidence_binding_invalid",
  "evidence_unavailable",
  "workspace_mismatch",
  "not_found",
  "invalid_transition",
  "store_corrupt",
  "write_failed",
]);
export type Lm1ErrorCode = z.infer<typeof lm1ErrorCodeSchema>;

export class Lm1Error extends Error {
  readonly code: Lm1ErrorCode;

  constructor(code: Lm1ErrorCode, message: string) {
    super(message);
    this.name = "Lm1Error";
    this.code = code;
  }
}
