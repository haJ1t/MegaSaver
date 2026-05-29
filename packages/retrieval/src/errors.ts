import { z } from "zod";

export const retrievalErrorCodeSchema = z.enum(["invalid_input"]);

export type RetrievalErrorCode = z.infer<typeof retrievalErrorCodeSchema>;

export class RetrievalError extends Error {
  readonly code: RetrievalErrorCode;

  constructor(code: RetrievalErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RetrievalError";
    this.code = code;
  }
}
