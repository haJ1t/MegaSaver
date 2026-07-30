import type { RankedChunk } from "./rank.js";
import { hammingDistance, simhash } from "./simhash.js";

// Pinned at 3 (spec §6 stage 6). Confirmed against the dedupe fixtures:
// a trailing-punctuation near-duplicate lands within 3 bits while
// fully distinct chunks exceed it.
export const HAMMING_DEDUPE_THRESHOLD = 3;

// Pigeonhole banding: split the 64-bit simhash into THRESHOLD+1 bands, so two
// hashes within THRESHOLD bits must share at least one WHOLE band. Only
// band-mates need a Hamming compare — same kept set as an all-pairs scan, but
// without its O(n^2) cost. Nothing caps chunk count ahead of this (a 15.6 MB
// hex log yields 6,400 chunks), and high-entropy output has no duplicates at
// all, so the all-pairs scan ran at full length while folding nothing.
// The band count is tied to the threshold — raising one without the other
// breaks the pigeonhole and silently keeps near-duplicates.
// ponytail: input that puts every hash in one bucket is still all-pairs; that
// shape has to be crafted, so cap bucket length only if it ever shows up.
const BAND_SHIFTS = [0n, 16n, 32n, 48n] as const;
const BAND_MASK = (1n << 16n) - 1n;

export function dedupe(chunks: readonly RankedChunk[]): RankedChunk[] {
  // Clusters form in score order (ties → earlier), not document order: the
  // first member seen is the one that survives, and first-in-document let an
  // early boring chunk outlive a later duplicate carrying the error evidence
  // (SC3-4). The kept set still returns in document order — the caller's
  // contract before scoring entered the picture.
  const byScore = chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => b.chunk.score - a.chunk.score || a.index - b.index);
  const kept: { chunk: RankedChunk; index: number }[] = [];
  const bands = BAND_SHIFTS.map((shift) => ({ shift, buckets: new Map<bigint, bigint[]>() }));
  for (const entry of byScore) {
    const hash = simhash(entry.chunk.text);
    const isDup = bands.some(
      ({ shift, buckets }) =>
        buckets
          .get((hash >> shift) & BAND_MASK)
          ?.some((h) => hammingDistance(h, hash) <= HAMMING_DEDUPE_THRESHOLD) === true,
    );
    if (isDup) continue;
    kept.push(entry);
    for (const { shift, buckets } of bands) {
      const key = (hash >> shift) & BAND_MASK;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [hash]);
      else bucket.push(hash);
    }
  }
  return kept.sort((a, b) => a.index - b.index).map((entry) => entry.chunk);
}
