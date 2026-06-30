import { createHash } from "node:crypto";
import { join } from "node:path";
import { embed, readVectors, writeVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import type { MemoryEntry } from "./memory-entry.js";

// Per-project memory-vector sidecar, sibling to <storeRoot>/memory/<projectId>.jsonl.
// Keyed by memory id so the semantic searcher looks vectors up by id. We do NOT
// add a vector field to MemoryEntry — the sidecar is the only new artifact.
export function memoryEmbeddingsSidecarPath(storeRoot: string, projectId: ProjectId): string {
  return join(storeRoot, "memory", `${projectId}.embeddings.jsonl`);
}

// The text we embed for a memory: title + content (the recall surface, same as
// the BM25 surface minus keywords, which are already lexical).
export function memoryEmbedText(entry: MemoryEntry): string {
  return `${entry.title}\n${entry.content}`;
}

// Content hash deciding carry-forward. MemoryEntry has no contentHash field, so
// derive one from title+content — the only inputs to memoryEmbedText.
function memoryContentHash(entry: MemoryEntry): string {
  return createHash("sha256").update(memoryEmbedText(entry)).digest("hex");
}

// Embed function shape; defaults to the real lazy embed(). Injectable so the
// carry-forward logic can be unit-tested with a counting fake — no model.
export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>;

// Build/refresh the memory-vector sidecar for the current memory set. Incremental:
// a memory whose id + content hash is unchanged from the prior build carries its
// existing vector forward (no re-embed); only new/changed memories are embedded,
// in a single batched embed() call. The sidecar is rebuilt from the current set,
// so a dropped memory's vector is removed. `priorHashById` is the id→contentHash
// map captured BEFORE the memory store was overwritten. Mirrors embedBlocks.
export async function embedMemoryEntries(
  storeRoot: string,
  projectId: ProjectId,
  entries: readonly MemoryEntry[],
  priorHashById: ReadonlyMap<string, string>,
  embedFn: EmbedFn = embed,
): Promise<void> {
  const sidecarPath = memoryEmbeddingsSidecarPath(storeRoot, projectId);
  const priorVectors = readVectors(sidecarPath);

  const carried = new Map<string, number[]>();
  const toEmbed: MemoryEntry[] = [];
  for (const entry of entries) {
    const prior = priorVectors.get(entry.id);
    if (prior !== undefined && priorHashById.get(entry.id) === memoryContentHash(entry)) {
      carried.set(entry.id, Array.from(prior));
    } else {
      toEmbed.push(entry);
    }
  }

  const fresh = toEmbed.length > 0 ? await embedFn(toEmbed.map(memoryEmbedText)) : [];
  const out = entries.map((entry) => {
    const carriedVec = carried.get(entry.id);
    if (carriedVec !== undefined) return { id: entry.id, vector: carriedVec };
    const i = toEmbed.indexOf(entry);
    return { id: entry.id, vector: Array.from(fresh[i] ?? []) };
  });

  writeVectors(sidecarPath, out);
}
