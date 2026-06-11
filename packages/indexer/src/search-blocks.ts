import { rankBm25 } from "@megasaver/retrieval";
import type { BlockType, CodeBlock } from "./code-block.js";

const DEFAULT_LIMIT = 20;

export type BlockSearchQuery = { text: string; type?: BlockType; limit?: number };
export type BlockSearchHit = { block: CodeBlock; score: number };

// BM25 over name + keywords + filePath. Optional type filter applies before
// ranking; zero-overlap (score 0) blocks are dropped so only real matches
// return. Lives here (not in the CLI) because §3c forbids a CLI→retrieval edge.
export function searchBlocks(
  blocks: readonly CodeBlock[],
  query: BlockSearchQuery,
): BlockSearchHit[] {
  const filtered = blocks.filter(
    (block) => query.type === undefined || block.blockType === query.type,
  );
  const documents = filtered.map((block) => ({
    id: block.id,
    text: `${block.name ?? ""} ${block.keywords.join(" ")} ${block.filePath}`,
  }));
  const byId = new Map(filtered.map((block) => [block.id, block]));
  return rankBm25({ query: query.text, documents, topN: query.limit ?? DEFAULT_LIMIT })
    .filter((hit) => hit.score > 0)
    .map((hit) => ({ block: byId.get(hit.id as CodeBlock["id"]), score: hit.score }))
    .filter((hit): hit is BlockSearchHit => hit.block !== undefined);
}
