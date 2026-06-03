import type { Chunk } from "@megasaver/content-store";
import { fetchChunk } from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type FetchChunkToolEnv = { storeRoot: string };

const fetchChunkInputSchema = z
  .object({
    chunkSetId: z.string().min(1),
    chunkId: z.string().min(1),
    around: z.number().int().nonnegative().optional(),
  })
  .strict();

export type FetchChunkToolResult = {
  chunkSetId: string;
  chunkId: string;
  chunk: Chunk;
};

export async function handleFetchChunk(
  env: FetchChunkToolEnv,
  rawArgs: unknown,
): Promise<FetchChunkToolResult> {
  const parsed = fetchChunkInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { chunkSetId, chunkId } = parsed.data;

  const outcome = await fetchChunk({ storeRoot: env.storeRoot, chunkSetId, chunkId });
  if (!outcome.ok) {
    if (outcome.reason === "store_corrupt") {
      throw new McpBridgeError("content_store_miss", `chunk store corrupt: ${outcome.detail}`);
    }
    throw new McpBridgeError(
      "content_store_miss",
      outcome.reason === "chunk_set_not_found"
        ? `chunk set not found: ${chunkSetId}`
        : `chunk not found: ${chunkId} in ${chunkSetId}`,
    );
  }
  return { chunkSetId, chunkId, chunk: outcome.chunk };
}
