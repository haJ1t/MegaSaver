import { z } from "zod";

export const coreRegistryErrorCodeSchema = z.enum([
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_already_ended",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
  "memory_entry_not_found",
  "project_rule_already_exists",
  "project_rule_not_found",
  "failed_attempt_already_exists",
  "failed_attempt_not_found",
  "failed_attempt_already_converted",
]);

export type CoreRegistryErrorCode = z.infer<typeof coreRegistryErrorCodeSchema>;

export class CoreRegistryError extends Error {
  readonly code: CoreRegistryErrorCode;

  constructor(code: CoreRegistryErrorCode, message: string) {
    super(message);
    this.name = "CoreRegistryError";
    this.code = coreRegistryErrorCodeSchema.parse(code);
  }
}

export const corePersistenceErrorCodeSchema = z.enum([
  "store_root_invalid",
  "store_read_failed",
  "store_write_failed",
  "store_json_invalid",
  "store_entity_invalid",
]);

export type CorePersistenceErrorCode = z.infer<typeof corePersistenceErrorCodeSchema>;

export class CorePersistenceError extends Error {
  readonly code: CorePersistenceErrorCode;
  readonly filePath: string | null;

  constructor(
    code: CorePersistenceErrorCode,
    message: string,
    options?: { filePath?: string; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CorePersistenceError";
    this.code = corePersistenceErrorCodeSchema.parse(code);
    this.filePath = options?.filePath ?? null;
  }
}
