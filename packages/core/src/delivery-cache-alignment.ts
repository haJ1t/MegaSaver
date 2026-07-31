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
  coordinates?: CoordinateBounds | undefined;
}

/**
 * Evaluates cache-aligned transform decision for tool output delivery.
 * Preserves prompt cache by returning EMIT_UNCHANGED_MARKER on re-reads.
 */
export function evaluateCacheAlignedTransform(
  content: string,
  hash: string,
  seenLedger: Set<string>,
  coordinates?: CoordinateBounds,
): TransformDecision {
  if (seenLedger.has(hash)) {
    return {
      action: "EMIT_UNCHANGED_MARKER",
      contentHash: hash,
      outputContent: `<!-- mega-unchanged: ${hash} -->`,
      reason:
        "Content already in seen-hash ledger; emitting unchanged marker to preserve prompt cache",
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
    coordinates,
  };
}
