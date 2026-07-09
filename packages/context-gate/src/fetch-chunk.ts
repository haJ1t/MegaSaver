import { ContentStoreError, loadChunkSet } from "@megasaver/content-store";
import { type FetchOverlayChunkResult, fetchOverlayChunk } from "./fetch-overlay-chunk.js";
import { locateChunkSet } from "./locate-chunk-set.js";

export type FetchChunkResult = FetchOverlayChunkResult;

export async function fetchChunk(input: {
  storeRoot: string;
  chunkSetId: string;
  chunkId: string;
}): Promise<FetchChunkResult> {
  const located = locateChunkSet({ storeRoot: input.storeRoot, chunkSetId: input.chunkSetId });
  if (located === null) return { ok: false, reason: "chunk_set_not_found" };

  // Overlay sets share fetchOverlayChunk's load + error translation — the two
  // layouts differ only in how the store path is keyed.
  if (located.layout === "overlay") {
    return fetchOverlayChunk({
      storeRoot: input.storeRoot,
      workspaceKey: located.workspaceKey,
      liveSessionId: located.liveSessionId,
      chunkSetId: input.chunkSetId,
      chunkId: input.chunkId,
    });
  }

  let chunkSet: Awaited<ReturnType<typeof loadChunkSet>>;
  try {
    chunkSet = await loadChunkSet({
      storeRoot: input.storeRoot,
      projectId: located.projectId,
      sessionId: located.sessionId,
      chunkSetId: input.chunkSetId,
    });
  } catch (err) {
    if (err instanceof ContentStoreError) {
      if (err.code === "not_found") return { ok: false, reason: "chunk_set_not_found" };
      return { ok: false, reason: "store_corrupt", detail: err.message };
    }
    throw err;
  }

  const chunk = chunkSet.chunks.find((c) => c.id === input.chunkId);
  if (chunk === undefined) return { ok: false, reason: "chunk_not_found" };
  return { ok: true, chunk };
}
