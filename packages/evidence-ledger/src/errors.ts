import { z } from "zod";

export const evidenceLedgerErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
  "already_exists",
  "invalid_transition",
  "workspace_mismatch",
]);
export type EvidenceLedgerErrorCode = z.infer<typeof evidenceLedgerErrorCodeSchema>;

export class EvidenceLedgerError extends Error {
  readonly code: EvidenceLedgerErrorCode;
  constructor(code: EvidenceLedgerErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = "EvidenceLedgerError";
    this.code = code;
  }
}
