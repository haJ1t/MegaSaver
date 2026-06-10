import { lstatSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { SkillPackError } from "./errors.js";

// Containment is structural (path.relative), not lexical startsWith —
// "/x/packs-evil" must not pass a "/x/packs" prefix. Symlinked entries
// are rejected outright: a link inside the pack is an escape pointer.
export function assertEntryWithinPack(packRoot: string, entry: string): string {
  if (isAbsolute(entry)) {
    throw new SkillPackError("pack_path_escape", `absolute entry path: ${entry}`, {
      packPath: packRoot,
    });
  }
  const absolute = resolve(packRoot, entry);
  const rel = relative(resolve(packRoot), absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new SkillPackError("pack_path_escape", `entry escapes pack root: ${entry}`, {
      packPath: packRoot,
    });
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(absolute);
  } catch (err) {
    throw new SkillPackError("pack_unreadable", `entry file missing or unreadable: ${entry}`, {
      packPath: packRoot,
      cause: err,
    });
  }
  if (stat.isSymbolicLink()) {
    throw new SkillPackError("pack_path_escape", `symlinked entry rejected: ${entry}`, {
      packPath: packRoot,
    });
  }
  return absolute;
}
