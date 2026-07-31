/**
 * @scaffold UNWIRED DELIVERY CACHE ALIGNMENT PIPELINE
 * WARNING: Unwired delivery pipeline scaffold. Full AST transformation requires
 * integration with @megasaver/output-filter and @megasaver/content-store.
 */
export interface CoordinateBounds {
  rawStartLine: number;
  rawEndLine: number;
  casHash?: string;
}

export type TransformAction = "TRANSFORM_FIRST_SIGHT" | "PASSTHROUGH" | "EMIT_UNCHANGED_MARKER";

export interface TransformDecision {
  action: TransformAction;
  contentHash: string;
  outputContent: string;
  reason: string;
  priorChunkSetId?: string | undefined;
  priorMeshHandle?: string | undefined;
  coordinates?: CoordinateBounds | undefined;
}

export interface TransformOptions {
  priorChunkSetId?: string;
  priorMeshHandle?: string;
  coordinates?: CoordinateBounds;
  bypassCache?: boolean;
}

/**
 * Evaluates cache-aligned transform decision for tool output delivery.
 * Emits addressable EMIT_UNCHANGED_MARKER carrying priorChunkSetId on re-reads (I2/D3 compliance).
 */
export function evaluateCacheAlignedTransform(
  content: string,
  hash: string,
  seenLedger: Set<string>,
  options: TransformOptions = {},
): TransformDecision {
  const { priorChunkSetId, priorMeshHandle, coordinates, bypassCache } = options;

  if (bypassCache) {
    return {
      action: "PASSTHROUGH",
      contentHash: hash,
      outputContent: content,
      reason: "Bypass cache requested; raw passthrough preserving prompt stream",
      priorChunkSetId,
      priorMeshHandle,
      coordinates,
    };
  }

  if (seenLedger.has(hash)) {
    const chunkAttr = priorChunkSetId ? ` priorChunkSetId="${priorChunkSetId}"` : "";
    const handleAttr = priorMeshHandle ? ` priorMeshHandle="${priorMeshHandle}"` : "";
    return {
      action: "EMIT_UNCHANGED_MARKER",
      contentHash: hash,
      outputContent: `<!-- mega-unchanged: ${hash}${chunkAttr}${handleAttr} -->`,
      reason:
        "Content already in seen-hash ledger; emitting addressable unchanged marker to preserve prompt cache",
      priorChunkSetId,
      priorMeshHandle,
      coordinates,
    };
  }

  // Atomically register seen hash in ledger on first sight
  seenLedger.add(hash);

  return {
    action: "TRANSFORM_FIRST_SIGHT",
    contentHash: hash,
    outputContent: content,
    reason: "First sight content; registered in seen-hash ledger",
    priorChunkSetId,
    priorMeshHandle,
    coordinates,
  };
}
