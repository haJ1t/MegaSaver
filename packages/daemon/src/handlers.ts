import { fetchOverlayChunk, recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { outputSourceKindSchema } from "@megasaver/output-filter";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export type HandlerResponse = { status: number; json: Record<string, unknown> };

const excerptRequestSchema = z
  .object({
    workspaceKey: z.string().min(1),
    liveSessionId: z.string().min(1),
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
    workspaceKey: z.string().min(1),
    liveSessionId: z.string().min(1),
    chunkSetId: z.string().min(1),
    chunkId: z.string().min(1),
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
