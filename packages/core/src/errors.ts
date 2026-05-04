import { z } from "zod";

export const coreRegistryErrorCodeSchema = z.enum([
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
]);

export type CoreRegistryErrorCode = z.infer<
  typeof coreRegistryErrorCodeSchema
>;

export class CoreRegistryError extends Error {
  readonly code: CoreRegistryErrorCode;

  constructor(code: CoreRegistryErrorCode, message: string) {
    super(message);
    this.name = "CoreRegistryError";
    this.code = coreRegistryErrorCodeSchema.parse(code);
  }
}
