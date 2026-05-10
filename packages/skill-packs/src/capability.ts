import { z } from "zod";

// Order: alphabetic. Capability names mirror permission grammar
// elsewhere in Mega Saver (`read-*` / `write-*`). Do not reorder
// — installer surfaces (`mega pack info`) derive their listing
// from this tuple.
export const skillPackCapabilitySchema = z.enum(["network", "read-memory", "write-memory"]);

export type SkillPackCapability = z.infer<typeof skillPackCapabilitySchema>;
