import { z } from "zod";

// Order: alphabetic. Used as schema-canonical ordering for derived
// `mega pack info` / `--help` text once the loader lands. Do not
// reorder.
export const skillPackKindSchema = z.enum(["prompt", "skill", "workflow"]);

export type SkillPackKind = z.infer<typeof skillPackKindSchema>;
