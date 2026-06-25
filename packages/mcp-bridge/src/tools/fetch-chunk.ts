import type { Chunk } from "@megasaver/content-store";
import { fetchChunk } from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type FetchChunkToolEnv = {
  storeRoot: string;
  // When present, only chunkSetIds in this set may be expanded.
  // Absent = unconstrained (CLI/non-agent callers). Never set to undefined
  // for agent MCP dispatch — always pass the current-response set (may be empty).
  allowedChunkSetIds?: ReadonlySet<string>;
};

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

  if (env.allowedChunkSetIds !== undefined && !env.allowedChunkSetIds.has(chunkSetId)) {
    throw new McpBridgeError(
      "expansion_blocked",
      `chunk set not in current response set: ${chunkSetId}`,
    );
  }

  // ponytail: in-process path only. The daemon /expand reads the OVERLAY chunk
  // store; in-process fetchChunk reads the REGISTRY chunk store. A chunkSetId
  // minted in-process is not expandable via the daemon and vice-versa. Forwarding
  // fetch-chunk requires a unified (or session-mapped) chunk store — a separate
  // daemon-side phase. The allowedChunkSetIds guard above MUST run in-process
  // before any future daemon call (daemon /expand has no per-session guard).
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
