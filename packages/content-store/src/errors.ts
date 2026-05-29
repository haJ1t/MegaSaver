import { z } from "zod";

export const contentStoreErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
]);

export type ContentStoreErrorCode = z.infer<typeof contentStoreErrorCodeSchema>;

export class ContentStoreError extends Error {
  readonly code: ContentStoreErrorCode;

  constructor(code: ContentStoreErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = "ContentStoreError";
    this.code = code;
  }
}
