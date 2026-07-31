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

export const telemetryValidationErrorCodeSchema = z.enum([
  "missing_workspace_path",
  "missing_session_id",
  "missing_store_root",
  "schema_invalid",
]);
export type TelemetryValidationErrorCode = z.infer<typeof telemetryValidationErrorCodeSchema>;

export class TelemetryValidationError extends Error {
  readonly code: TelemetryValidationErrorCode;

  constructor(code: TelemetryValidationErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TelemetryValidationError";
    this.code = code;
  }
}
