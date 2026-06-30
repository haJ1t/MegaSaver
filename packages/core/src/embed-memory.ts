import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { embed, readVectors, writeVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import type { MemoryEntry } from "./memory-entry.js";

// Per-project memory-vector sidecar, sibling to <storeRoot>/memory/<projectId>.jsonl.
// Keyed by memory id so the semantic searcher looks vectors up by id. We do NOT
// add a vector field to MemoryEntry — the sidecar is the only new artifact.
export function memoryEmbeddingsSidecarPath(storeRoot: string, projectId: ProjectId): string {
  return join(storeRoot, "memory", `${projectId}.embeddings.jsonl`);
}

// id→contentHash record, the manifest the vector sidecar lacks. Captured after
// each build, read back as priorHashById next build so an unchanged memory
// (vector present AND hash matches) carries forward instead of re-embedding.
function memoryHashSidecarPath(storeRoot: string, projectId: ProjectId): string {
  return join(storeRoot, "memory", `${projectId}.embeddings.hashes.json`);
}

function readHashSidecar(path: string): Map<string, string> {
  try {
    return new Map(
      Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, string>),
    );
  } catch {
    return new Map();
  }
}

// tmp + fsync + rename, the same crash-safe write writeVectors uses for the
// vector sidecar — so the hash manifest can never be left half-written and out
// of sync with the vectors it tracks.
function atomicWriteFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
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

export type MemoryEmbedResult = { embedded: number; carried: number };

// Build/refresh the memory-vector sidecar for the current memory set. Incremental:
// a memory whose id + content hash is unchanged from the prior build carries its
// existing vector forward (no re-embed); only new/changed memories are embedded,
// in a single batched embed() call. The sidecar is rebuilt from the current set,
// so a dropped memory's vector is removed. `priorHashById` is the id→contentHash
// map captured BEFORE the memory store was overwritten. Mirrors embedBlocks.
// Returns the actual embed/carry split so callers report counts from the SAME
// decision made here (the carry-forward also requires the prior vector to exist,
// which a hash-only check at the call site cannot see).
export async function embedMemoryEntries(
  storeRoot: string,
  projectId: ProjectId,
  entries: readonly MemoryEntry[],
  priorHashById: ReadonlyMap<string, string>,
  embedFn: EmbedFn = embed,
): Promise<MemoryEmbedResult> {
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
  return { embedded: toEmbed.length, carried: carried.size };
}

export type MemoryIndexBuildResult = { embedded: number; carried: number; total: number };

// On-demand build of the memory-vector sidecar (the missing production caller
// for embedMemoryEntries) — the memory analog of `mega index build`. Reads the
// prior id→hash manifest, runs the incremental embedder, then rewrites the
// manifest from the current set so the next build can carry forward. Heavy
// (loads the model on a real embed) → an explicit user/agent action, never on
// the save hot path. `embedFn` is injectable for model-free tests.
export async function buildMemoryIndex(
  storeRoot: string,
  projectId: ProjectId,
  entries: readonly MemoryEntry[],
  embedFn: EmbedFn = embed,
): Promise<MemoryIndexBuildResult> {
  const hashPath = memoryHashSidecarPath(storeRoot, projectId);
  const priorHashById = readHashSidecar(hashPath);

  // Counts come straight from the embedder's own carry-forward decision, which
  // also accounts for a missing prior vector — a hash-only check here could not.
  const { embedded, carried } = await embedMemoryEntries(
    storeRoot,
    projectId,
    entries,
    priorHashById,
    embedFn,
  );

  const nextHashes: Record<string, string> = {};
  for (const e of entries) nextHashes[e.id] = memoryContentHash(e);
  atomicWriteFile(hashPath, JSON.stringify(nextHashes));

  return { embedded, carried, total: entries.length };
}
