import { join } from "node:path";
import { embed, readVectors, writeVectors } from "@megasaver/embeddings";
import type { CodeBlock } from "./code-block.js";
import type { IndexStorePaths } from "./store.js";

export function embeddingsSidecarPath(paths: IndexStorePaths): string {
  return join(paths.indexDir, "embeddings.jsonl");
}

// The text we embed for a block: name + summary + keywords. Falls back to the
// block id when all three are empty so we never hand "" to the model.
function embedText(block: CodeBlock): string {
  const text = `${block.name ?? ""} ${block.summary ?? ""} ${block.keywords.join(" ")}`.trim();
  return text.length > 0 ? text : block.id;
}

// Embed function shape; defaults to the real lazy embed(). Injectable so the
// carry-forward logic can be unit-tested with a counting fake — no model.
export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>;

// Build/refresh the embeddings.jsonl sidecar for the just-written block set.
// Incremental: a block whose id+contentHash is unchanged from the prior build
// carries its existing vector forward (no re-embed); only new/changed blocks
// are embedded, in a single batched embed() call. The sidecar is keyed by
// block id (the factor + searchBlocks look up vectors by id). `priorHashById`
// is the id→contentHash map captured BEFORE blocks.jsonl was overwritten.
export async function embedBlocks(
  paths: IndexStorePaths,
  blocks: readonly CodeBlock[],
  priorHashById: ReadonlyMap<string, string>,
  embedFn: EmbedFn = embed,
): Promise<void> {
  const sidecarPath = embeddingsSidecarPath(paths);
  const priorVectors = readVectors(sidecarPath);

  const carried = new Map<string, number[]>();
  const toEmbed: CodeBlock[] = [];
  for (const block of blocks) {
    const prior = priorVectors.get(block.id);
    if (prior !== undefined && priorHashById.get(block.id) === block.contentHash) {
      carried.set(block.id, Array.from(prior));
    } else {
      toEmbed.push(block);
    }
  }

  const fresh = toEmbed.length > 0 ? await embedFn(toEmbed.map(embedText)) : [];
  const entries = blocks.map((block) => {
    const carriedVec = carried.get(block.id);
    if (carriedVec !== undefined) return { id: block.id, vector: carriedVec };
    const i = toEmbed.indexOf(block);
    return { id: block.id, vector: Array.from(fresh[i] ?? []) };
  });

  writeVectors(sidecarPath, entries);
}
