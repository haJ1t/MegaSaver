import { sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

// B1: signed aggregate. Optional on read so pre-B1 summary files keep parsing;
// absent means "pre-B1, only the clamped legacy totals are known". Appends seed
// a legacy summary from its bytesSavedTotal and then fold signed deltas, so the
// signed total stays continuous with history instead of restarting at 0.
const deltaBytesTotalField = z.number().int().optional();

export const sessionTokenSaverStatsSchema = z
  .object({
    sessionId: sessionIdSchema,
    eventsTotal: z.number().int().nonnegative(),
    rawBytesTotal: z.number().int().nonnegative(),
    returnedBytesTotal: z.number().int().nonnegative(),
    bytesSavedTotal: z.number().int().nonnegative(),
    deltaBytesTotal: deltaBytesTotalField,
    savingRatio: z.number().min(0).max(1),
    secretsRedactedTotal: z.number().int().nonnegative(),
    chunksStoredTotal: z.number().int().nonnegative(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SessionTokenSaverStats = z.infer<typeof sessionTokenSaverStatsSchema>;

// F4 live-first variant: sessionId → liveSessionId (permissive transcript uuid).
export const overlaySessionTokenSaverStatsSchema = z
  .object({
    liveSessionId: z.string().min(1),
    eventsTotal: z.number().int().nonnegative(),
    rawBytesTotal: z.number().int().nonnegative(),
    returnedBytesTotal: z.number().int().nonnegative(),
    bytesSavedTotal: z.number().int().nonnegative(),
    deltaBytesTotal: deltaBytesTotalField,
    savingRatio: z.number().min(0).max(1),
    secretsRedactedTotal: z.number().int().nonnegative(),
    chunksStoredTotal: z.number().int().nonnegative(),
    updatedAt: z.string().datetime({ offset: true }),
    // E24: present iff the summary was reconstructed from its events JSONL.
    rebuiltAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type OverlaySessionTokenSaverStats = z.infer<typeof overlaySessionTokenSaverStatsSchema>;
