import { type Chunk, ContentStoreError, loadOverlayChunkSet } from "@megasaver/content-store";

export type FetchOverlayChunkResult =
  | { ok: true; chunk: Chunk }
  | { ok: false; reason: "chunk_set_not_found" }
  | { ok: false; reason: "chunk_not_found" }
  | { ok: false; reason: "store_corrupt"; detail: string };

// Overlay twin of fetchChunk: overlay chunk sets are keyed by
// (workspaceKey, liveSessionId) and use a different schema, so the non-overlay
// locate+loadChunkSet path would mis-parse them. The caller already knows the
// live keys, so no locate scan is needed — load directly.
export async function fetchOverlayChunk(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  chunkSetId: string;
  chunkId: string;
}): Promise<FetchOverlayChunkResult> {
  let chunkSet: Awaited<ReturnType<typeof loadOverlayChunkSet>>;
  try {
    chunkSet = await loadOverlayChunkSet({
      storeRoot: input.storeRoot,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
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
