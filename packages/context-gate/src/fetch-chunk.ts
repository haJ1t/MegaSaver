import {
  type Chunk,
  ContentStoreError,
  loadChunkSet,
  loadOverlayChunkSet,
} from "@megasaver/content-store";
import { locateChunkSet } from "./locate-chunk-set.js";

export type FetchChunkResult =
  | { ok: true; chunk: Chunk }
  | { ok: false; reason: "chunk_set_not_found" }
  | { ok: false; reason: "chunk_not_found" }
  | { ok: false; reason: "store_corrupt"; detail: string };

export async function fetchChunk(input: {
  storeRoot: string;
  chunkSetId: string;
  chunkId: string;
}): Promise<FetchChunkResult> {
  const located = locateChunkSet({ storeRoot: input.storeRoot, chunkSetId: input.chunkSetId });
  if (located === null) return { ok: false, reason: "chunk_set_not_found" };

  let chunks: readonly Chunk[];
  try {
    if (located.layout === "overlay") {
      const overlay = await loadOverlayChunkSet({
        storeRoot: input.storeRoot,
        workspaceKey: located.workspaceKey,
        liveSessionId: located.liveSessionId,
        chunkSetId: input.chunkSetId,
      });
      chunks = overlay.chunks;
    } else {
      const registry = await loadChunkSet({
        storeRoot: input.storeRoot,
        projectId: located.projectId,
        sessionId: located.sessionId,
        chunkSetId: input.chunkSetId,
      });
      chunks = registry.chunks;
    }
  } catch (err) {
    if (err instanceof ContentStoreError) {
      if (err.code === "not_found") return { ok: false, reason: "chunk_set_not_found" };
      return { ok: false, reason: "store_corrupt", detail: err.message };
    }
    throw err;
  }

  const chunk = chunks.find((c) => c.id === input.chunkId);
  if (chunk === undefined) return { ok: false, reason: "chunk_not_found" };
  return { ok: true, chunk };
}
