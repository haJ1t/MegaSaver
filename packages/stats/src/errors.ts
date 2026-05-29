import { z } from "zod";

export const statsErrorCodeSchema = z.enum(["schema_invalid", "store_corrupt", "write_failed"]);

export type StatsErrorCode = z.infer<typeof statsErrorCodeSchema>;

export class StatsError extends Error {
  readonly code: StatsErrorCode;

  constructor(code: StatsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "StatsError";
    this.code = code;
  }
}
