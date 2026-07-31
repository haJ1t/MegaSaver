export interface CoordinateBounds {
  rawStartLine: number;
  rawEndLine: number;
  casHash?: string;
}

export type TransformAction = 'TRANSFORM_FIRST_SIGHT' | 'PASSTHROUGH' | 'EMIT_UNCHANGED_MARKER';

export interface TransformDecision {
  action: TransformAction;
  contentHash: string;
  outputContent: string;
  reason: string;
  coordinates?: CoordinateBounds | undefined;
}

export function evaluateCacheAlignedTransform(
  content: string,
  hash: string,
  seenLedger: Set<string>,
  coordinates?: CoordinateBounds
): TransformDecision {
  if (seenLedger.has(hash)) {
    return {
      action: 'PASSTHROUGH',
      contentHash: hash,
      outputContent: content,
      reason: 'Content already in seen-hash ledger; raw passthrough preserving prompt cache',
      coordinates,
    };
  }

  // Atomically register seen hash
  seenLedger.add(hash);

  return {
    action: 'TRANSFORM_FIRST_SIGHT',
    contentHash: hash,
    outputContent: content,
    reason: 'First sight content; transformed chunk registered in ledger',
    coordinates,
  };
}
