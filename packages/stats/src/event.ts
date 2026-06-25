import { outputSourceKindSchema } from "@megasaver/output-filter";
import { projectIdSchema, sessionIdSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { isSafeSegment } from "./safe-segment.js";

// Overlay keys are interpolated into the on-disk path — reject containment-
// breaking segments (`..`, `/`, …) at the schema boundary, before any write.
const safeSegment = z.string().min(1).refine(isSafeSegment, "unsafe path segment");

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

// F4 live-first variant: (projectId, sessionId) → (workspaceKey, liveSessionId).
// Both keys are permissive path-safe strings (workspaceKey is the F3 cwd hash,
// liveSessionId the transcript uuid) — never re-branded to the project FK pair.
export const overlayTokenSaverEventSchema = z
  .object({
    id: z.string().min(1),
    liveSessionId: safeSegment,
    workspaceKey: safeSegment,
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

export type OverlayTokenSaverEvent = z.infer<typeof overlayTokenSaverEventSchema>;
