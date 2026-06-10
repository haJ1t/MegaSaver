import { z } from "zod";

// Order: alphabetic (AA3). Widened from the v0.3 placeholder when the
// real loader landed; not_implemented retired (no external consumer,
// pre-1.0 — CLAUDE.md §13 no backward-compat shims).
export const skillPackErrorCodeSchema = z.enum([
  "manifest_invalid",
  "manifest_missing",
  "pack_already_installed",
  "pack_not_found",
  "pack_path_escape",
  "pack_unreadable",
  "skill_id_conflict",
]);

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
