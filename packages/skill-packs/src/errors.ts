import { z } from "zod";

// Order: alphabetic. v0.3 ships a single member; future codes
// (manifest_invalid, manifest_missing, pack_already_installed,
// pack_not_found, pack_path_escape, pack_unreadable,
// skill_id_conflict) are reserved per spec §7 and append in
// alphabetic order.
export const skillPackErrorCodeSchema = z.enum(["not_implemented"]);

export type SkillPackErrorCode = z.infer<typeof skillPackErrorCodeSchema>;

export class SkillPackError extends Error {
  readonly code: SkillPackErrorCode;
  readonly packPath: string | null;

  constructor(
    code: SkillPackErrorCode,
    message: string,
    options?: { packPath?: string; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SkillPackError";
    this.code = skillPackErrorCodeSchema.parse(code);
    this.packPath = options?.packPath ?? null;
  }
}
