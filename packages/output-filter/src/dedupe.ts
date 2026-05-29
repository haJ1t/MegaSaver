import type { RankedChunk } from "./rank.js";
import { hammingDistance, simhash } from "./simhash.js";

// Pinned at 3 (spec §6 stage 6). Confirmed against the dedupe fixtures:
// a trailing-punctuation near-duplicate lands within 3 bits while
// fully distinct chunks exceed it.
export const HAMMING_DEDUPE_THRESHOLD = 3;

export function dedupe(chunks: readonly RankedChunk[]): RankedChunk[] {
  const kept: RankedChunk[] = [];
  const hashes: bigint[] = [];
  for (const chunk of chunks) {
    const hash = simhash(chunk.text);
    const isDup = hashes.some((h) => hammingDistance(h, hash) <= HAMMING_DEDUPE_THRESHOLD);
    if (isDup) continue;
    kept.push(chunk);
    hashes.push(hash);
  }
  return kept;
}
