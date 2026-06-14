import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const chunkSchema = z
  .object({
    id: z.string().min(1),
    startLine: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    text: z.string(),
  })
  .strict();

export type Chunk = z.infer<typeof chunkSchema>;

export const chunkSetSchema = z
  .object({
    chunkSetId: z.string().min(1),
    sessionId: sessionIdSchema,
    projectId: projectIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    source: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("command"),
        command: z.string(),
        args: z.array(z.string()).readonly(),
      }),
      z.object({ kind: z.literal("file"), path: z.string() }),
      z.object({ kind: z.literal("grep"), query: z.string() }),
      z.object({ kind: z.literal("fetch"), url: z.string().url() }),
    ]),
    rawBytes: z.number().int().nonnegative(),
    redacted: z.boolean(),
    chunks: z.array(chunkSchema).readonly(),
  })
  .strict();

export type ChunkSet = z.infer<typeof chunkSetSchema>;

// F4 live-first variant: (projectId, sessionId) → (workspaceKey, liveSessionId)
// permissive path-safe strings. Same chunk body; only the key columns change.
export const overlayChunkSetSchema = z
  .object({
    chunkSetId: z.string().min(1),
    liveSessionId: z.string().min(1),
    workspaceKey: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    source: chunkSetSchema.shape.source,
    rawBytes: z.number().int().nonnegative(),
    redacted: z.boolean(),
    chunks: z.array(chunkSchema).readonly(),
  })
  .strict();

export type OverlayChunkSet = z.infer<typeof overlayChunkSetSchema>;

export type ChunkSetSummary = {
  chunkSetId: string;
  createdAt: string;
  source: ChunkSet["source"];
  rawBytes: number;
  redacted: boolean;
  chunkCount: number;
};
