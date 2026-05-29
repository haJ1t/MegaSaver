import { outputSourceKindSchema } from "@megasaver/output-filter";
import { projectIdSchema, sessionIdSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export const tokenSaverEventSchema = z
  .object({
    id: z.string().min(1),
    sessionId: sessionIdSchema,
    projectId: projectIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    sourceKind: outputSourceKindSchema,
    label: z.string(),
    rawBytes: z.number().int().nonnegative(),
    returnedBytes: z.number().int().nonnegative(),
    bytesSaved: z.number().int().nonnegative(),
    savingRatio: z.number().min(0).max(1),
    chunkSetId: z.string().min(1).optional(),
    summary: z.string(),
    mode: tokenSaverModeSchema,
  })
  .strict();

export type TokenSaverEvent = z.infer<typeof tokenSaverEventSchema>;
