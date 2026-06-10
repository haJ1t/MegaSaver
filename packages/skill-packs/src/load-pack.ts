import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assertEntryWithinPack } from "./entry-guard.js";
import { SkillPackError } from "./errors.js";
import { type SkillPackManifest, skillPackManifestSchema } from "./manifest.js";

const pathSchema = z.string().min(1, "loadPack: path must be a non-empty string");

export const MANIFEST_FILENAME = "megasaver-pack.json";

export async function loadPack(path: string): Promise<SkillPackManifest> {
  const packRoot = pathSchema.parse(path);
  const manifestPath = join(packRoot, MANIFEST_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    const code =
      (err as NodeJS.ErrnoException).code === "ENOENT" ? "manifest_missing" : "pack_unreadable";
    throw new SkillPackError(code, `cannot read ${MANIFEST_FILENAME}: ${String(err)}`, {
      packPath: packRoot,
      cause: err,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new SkillPackError("pack_unreadable", `broken JSON in ${MANIFEST_FILENAME}`, {
      packPath: packRoot,
      cause: err,
    });
  }

  const parsed = skillPackManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new SkillPackError("manifest_invalid", parsed.error.message, { packPath: packRoot });
  }

  for (const skill of parsed.data.skills) {
    assertEntryWithinPack(packRoot, skill.entry);
  }
  return parsed.data;
}
