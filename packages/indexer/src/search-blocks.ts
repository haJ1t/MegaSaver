import { cosine } from "@megasaver/embeddings";
import { rankBm25 } from "@megasaver/retrieval";
import type { BlockType, CodeBlock } from "./code-block.js";

const DEFAULT_LIMIT = 20;

export type BlockSearchQuery = { text: string; type?: BlockType; limit?: number };
export type BlockSearchHit = { block: CodeBlock; score: number };

// Pre-computed vectors for an optional cosine re-rank. Absent ⇒ pure BM25.
export type HybridVectors = {
  taskVector?: Float32Array;
  blockVectors?: Map<string, Float32Array>;
};

// BM25 over name + keywords + filePath. Optional type filter applies before
// ranking; zero-overlap (score 0) blocks are dropped so only real matches
// return. Lives here (not in the CLI) because §3c forbids a CLI→retrieval edge.
//
// Hybrid (optional): when a taskVector + blockVectors are supplied, the BM25
// hits are cosine-reranked — BM25 score normalized to 0..1 and blended with the
// clamped cosine of (taskVector, blockVector). Missing vectors ⇒ cosine 0, so
// the result degrades gracefully to pure BM25 when vectors are absent.
export function searchBlocks(
  blocks: readonly CodeBlock[],
  query: BlockSearchQuery,
  vectors?: HybridVectors,
): BlockSearchHit[] {
  const filtered = blocks.filter(
    (block) => query.type === undefined || block.blockType === query.type,
  );
  const documents = filtered.map((block) => ({
    id: block.id,
    text: `${block.name ?? ""} ${block.keywords.join(" ")} ${block.filePath}`,
  }));
  const byId = new Map(filtered.map((block) => [block.id, block]));
  const hits = rankBm25({ query: query.text, documents, topN: query.limit ?? DEFAULT_LIMIT })
    .filter((hit) => hit.score > 0)
    .map((hit) => ({ block: byId.get(hit.id as CodeBlock["id"]), score: hit.score }))
    // byId is built from the exact documents handed to rankBm25, so every
    // ranked id resolves; this filter only narrows the type, it never drops a
    // real hit.
    .filter((hit): hit is BlockSearchHit => hit.block !== undefined);

  const taskVector = vectors?.taskVector;
  const blockVectors = vectors?.blockVectors;
  if (taskVector === undefined || blockVectors === undefined || hits.length === 0) {
    return hits;
  }

  // Normalize BM25 by the top hit so it is comparable to cosine (0..1), then
  // blend. Stable: ties fall back to the original BM25 order.
  const maxBm25 = hits.reduce((m, h) => Math.max(m, h.score), 0) || 1;
  const blended = hits.map((hit, index) => {
    const v = blockVectors.get(hit.block.id);
    const cos = v === undefined ? 0 : Math.max(0, cosine(taskVector, v));
    return { hit, index, blend: hit.score / maxBm25 + cos };
  });
  blended.sort((a, b) => (b.blend === a.blend ? a.index - b.index : b.blend - a.blend));
  return blended.map((b) => b.hit);
}
