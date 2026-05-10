import { z } from "zod";
import { SkillPackError } from "./errors.js";
import type { SkillPackManifest } from "./manifest.js";

const pathSchema = z.string().min(1, "loadPack: path must be a non-empty string");

export function loadPack(path: string): Promise<SkillPackManifest> {
  const parsed = pathSchema.parse(path);
  return Promise.reject(
    new SkillPackError(
      "not_implemented",
      "skill-packs.loadPack: real loader is deferred to v0.3+; v0.3 ships scaffold only.",
      { packPath: parsed },
    ),
  );
}
