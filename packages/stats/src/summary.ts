import { sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const sessionTokenSaverStatsSchema = z
  .object({
    sessionId: sessionIdSchema,
    eventsTotal: z.number().int().nonnegative(),
    rawBytesTotal: z.number().int().nonnegative(),
    returnedBytesTotal: z.number().int().nonnegative(),
    bytesSavedTotal: z.number().int().nonnegative(),
    savingRatio: z.number().min(0).max(1),
    secretsRedactedTotal: z.number().int().nonnegative(),
    chunksStoredTotal: z.number().int().nonnegative(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SessionTokenSaverStats = z.infer<typeof sessionTokenSaverStatsSchema>;
