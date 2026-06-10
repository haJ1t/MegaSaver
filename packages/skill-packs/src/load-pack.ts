import { z } from "zod";
import { SkillPackError } from "./errors.js";
import type { SkillPackManifest } from "./manifest.js";

const pathSchema = z.string().min(1, "loadPack: path must be a non-empty string");

export function loadPack(path: string): Promise<SkillPackManifest> {
  const parsed = pathSchema.parse(path);
  return Promise.reject(
    new SkillPackError(
      "manifest_missing",
      "loadPack: real loader lands in the next commit.",
      { packPath: parsed },
    ),
  );
}
