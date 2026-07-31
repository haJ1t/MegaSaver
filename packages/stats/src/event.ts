import { outputSourceKindSchema } from "@megasaver/output-filter";
import { projectIdSchema, sessionIdSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { isSafeSegment } from "./safe-segment.js";

// Overlay keys are interpolated into the on-disk path — reject containment-
// breaking segments (`..`, `/`, …) at the schema boundary, before any write.
const safeSegment = z.string().min(1).refine(isSafeSegment, "unsafe path segment");

// B1 signed savings: `deltaBytes = rawBytes - returnedBytes`, NEVER clamped —
// negative means the rewrite inflated the payload. `bytesSaved` stays the
// clamped legacy field for one minor version; aggregates read the signed one.
// Optional on read so pre-B1 JSONL rows keep parsing; `deltaBytesOf` supplies
// the legacy interpretation (clamped bytesSaved — inflation was never recorded
// pre-B1, so that is the only honest reconstruction).
const deltaBytesField = z.number().int().optional();

// Measured with the real tokenizer at the write boundary. Optional so every
// pre-measurement row keeps parsing — absence means UNMEASURED, never zero and
// never bytes/4. Signed like deltaBytes: negative means the rewrite inflated.
const tokenCountField = z.number().int().nonnegative().optional();
const deltaTokensField = z.number().int().optional();

// B3 recovery debt: `kind` marks expansion (chunk re-injection) rows so
// reports can separate compression credits from recovery debits. Absent =
// compression (every pre-B3 row). `mode` is optional because an expansion row
// is charged to the session, not produced under a saver mode.
const eventKindField = z.enum(["compression", "expansion"]).optional();
const modeField = tokenSaverModeSchema.optional();

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
    deltaBytes: deltaBytesField,
    rawTokens: tokenCountField,
    returnedTokens: tokenCountField,
    deltaTokens: deltaTokensField,
    isFreshStore: z.boolean().optional(),
    modelId: z.string().min(1).optional(),
    savingRatio: z.number().min(0).max(1),
    chunkSetId: z.string().min(1).optional(),
    summary: z.string(),
    mode: modeField,
    kind: eventKindField,
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
    deltaBytes: deltaBytesField,
    rawTokens: tokenCountField,
    returnedTokens: tokenCountField,
    deltaTokens: deltaTokensField,
    isFreshStore: z.boolean().optional(),
    modelId: z.string().min(1).optional(),
    savingRatio: z.number().min(0).max(1),
    chunkSetId: z.string().min(1).optional(),
    summary: z.string(),
    mode: modeField,
    kind: eventKindField,
    // W5: event-carried counters. Optional so pre-wave-5 JSONL rows keep
    // parsing; rebuilds fold them so a lost summary no longer zeroes them.
    secretsRedacted: z.number().int().nonnegative().optional(),
    chunksStored: z.number().int().nonnegative().optional(),
  })
  .strict();

export type OverlayTokenSaverEvent = z.infer<typeof overlayTokenSaverEventSchema>;

// Single read rule for every fold/aggregate: the signed field when the writer
// emitted it, the legacy clamped value otherwise.
export function deltaBytesOf(event: {
  bytesSaved: number;
  deltaBytes?: number | undefined;
}): number {
  return event.deltaBytes ?? event.bytesSaved;
}

// Deliberately NOT falling back to tokensFromBytes(deltaBytes): a caller that
// cannot tell a measured token from an estimated one will mix them into one
// total. Callers that want the estimate ask for it explicitly and report the
// split (see estimated-value.ts).
export function deltaTokensOf(event: { deltaTokens?: number | undefined }): number | undefined {
  return event.deltaTokens;
}
