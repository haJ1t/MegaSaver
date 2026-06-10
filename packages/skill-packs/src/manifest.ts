import { z } from "zod";
import { skillPackCapabilitySchema } from "./capability.js";
import { skillPackKindSchema } from "./kind.js";

const kebabRegex = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Pack names are kebab-case identifiers. Exported so consumers that
// take a name from outside a validated manifest (e.g. `mega pack
// remove <name>`) can reject path-traversal before it reaches a
// filesystem join — a bare name flows into rmSync there.
export const packNameSchema = z.string().regex(kebabRegex, "pack name must be kebab-case");

// SemVer 2.0.0 surface — placeholder regex. Locks the manifest
// version contract without pulling in a runtime semver dependency
// at the scaffold tier. Loader spec will tighten this.
const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const skillRefSchema = z.object({
  id: z.string().regex(kebabRegex, "skill id must be kebab-case"),
  entry: z.string().min(1, "skill entry must be a non-empty path"),
});

export type SkillRef = z.infer<typeof skillRefSchema>;

export const skillPackManifestSchema = z.object({
  name: z.string().regex(kebabRegex, "pack name must be kebab-case"),
  version: z.string().regex(semverRegex, "pack version must be SemVer 2.0.0"),
  kind: skillPackKindSchema,
  skills: z.array(skillRefSchema).readonly(),
  capabilities: z.array(skillPackCapabilitySchema).readonly(),
  description: z.string().nullable(),
});

export type SkillPackManifest = z.infer<typeof skillPackManifestSchema>;
