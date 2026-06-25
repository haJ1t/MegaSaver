import { fetchOverlayChunk, recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { isSafeKeySegment, liveSessionIdSchema, workspaceKeySchema } from "@megasaver/core";
import { outputSourceKindSchema } from "@megasaver/output-filter";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export type HandlerResponse = { status: number; json: Record<string, unknown> };

// workspaceKey/liveSessionId/chunk ids become filesystem path segments downstream
// (stats dir + overlay chunk store), so a ".." value would escape the store root.
// Reject containment-breaking segments at the trust boundary, before any write.
const safeSegmentSchema = z.string().min(1).refine(isSafeKeySegment);

const excerptRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    raw: z.string(),
    sourceKind: outputSourceKindSchema,
    label: z.string(),
    mode: tokenSaverModeSchema,
    storeRawOutput: z.boolean(),
  })
  .strict();

export async function excerptHandler(storeRoot: string, body: unknown): Promise<HandlerResponse> {
  const parsed = excerptRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
  const result = await recordAndFilterOverlayOutput({ storeRoot, ...parsed.data });
  return { status: 200, json: { ...result } };
}

const expandRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    chunkSetId: safeSegmentSchema,
    chunkId: safeSegmentSchema,
  })
  .strict();

export async function expandHandler(storeRoot: string, body: unknown): Promise<HandlerResponse> {
  const parsed = expandRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
  const res = await fetchOverlayChunk({ storeRoot, ...parsed.data });
  if (res.ok) return { status: 200, json: { chunk: res.chunk } };
  if (res.reason === "store_corrupt") return { status: 500, json: { error: res.reason } };
  return { status: 404, json: { error: res.reason } };
}
