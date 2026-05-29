import { z } from "zod";

export const outputSourceKindSchema = z.enum(["command", "fetch", "file", "grep"]);

export type OutputSourceKind = z.infer<typeof outputSourceKindSchema>;
