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
  const kept: RankedChunk[] = [];
  const bands = BAND_SHIFTS.map((shift) => ({ shift, buckets: new Map<bigint, bigint[]>() }));
  for (const chunk of chunks) {
    const hash = simhash(chunk.text);
    const isDup = bands.some(
      ({ shift, buckets }) =>
        buckets
          .get((hash >> shift) & BAND_MASK)
          ?.some((h) => hammingDistance(h, hash) <= HAMMING_DEDUPE_THRESHOLD) === true,
    );
    if (isDup) continue;
    kept.push(chunk);
    for (const { shift, buckets } of bands) {
      const key = (hash >> shift) & BAND_MASK;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [hash]);
      else bucket.push(hash);
    }
  }
  return kept;
}
