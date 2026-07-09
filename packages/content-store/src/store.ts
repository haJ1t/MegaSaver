import { readFileSync, readdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type ProjectId,
  type SessionId,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { atomicWriteFile } from "./atomic-write.js";
import {
  type ChunkSet,
  type ChunkSetSummary,
  type OverlayChunkSet,
  chunkSetSchema,
  overlayChunkSetSchema,
} from "./chunk-set.js";
import { ContentStoreError } from "./errors.js";
import { chunkSetPath, overlayChunkSetPath } from "./paths.js";

export const READ_INDEX_FILENAME = "read-index.json";
export const SHOWN_INDEX_FILENAME = "shown-index.json";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function validateIds(projectId: ProjectId, sessionId: SessionId): void {
  try {
    projectIdSchema.parse(projectId);
    sessionIdSchema.parse(sessionId);
  } catch (error) {
    throw new ContentStoreError("schema_invalid", "Invalid id.", { cause: error });
  }
}

function sessionDir(storeRoot: string, projectId: ProjectId, sessionId: SessionId): string {
  return join(storeRoot, "content", projectId, sessionId);
}

export async function saveChunkSet(input: {
  storeRoot: string;
  chunkSet: ChunkSet;
}): Promise<void> {
  let chunkSet: ChunkSet;
  try {
    chunkSet = chunkSetSchema.parse(input.chunkSet);
  } catch (error) {
    throw new ContentStoreError("schema_invalid", "ChunkSet is invalid.", { cause: error });
  }

  const path = chunkSetPath({
    storeRoot: input.storeRoot,
    projectId: chunkSet.projectId,
    sessionId: chunkSet.sessionId,
    chunkSetId: chunkSet.chunkSetId,
  });

  atomicWriteFile(path, `${JSON.stringify(chunkSet, null, 2)}\n`);
}

function parseExistingFile(path: string, raw: string): ChunkSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ContentStoreError("store_corrupt", `Corrupt chunkSet file: ${path}`, {
      cause: error,
    });
  }
  try {
    return chunkSetSchema.parse(parsed);
  } catch (error) {
    throw new ContentStoreError("store_corrupt", `Corrupt chunkSet file: ${path}`, {
      cause: error,
    });
  }
}

export async function loadChunkSet(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): Promise<ChunkSet> {
  validateIds(input.projectId, input.sessionId);
  const path = chunkSetPath(input);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new ContentStoreError("not_found", `ChunkSet not found: ${input.chunkSetId}`);
    }
    throw error;
  }

  return parseExistingFile(path, raw);
}

export async function listChunkSets(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
}): Promise<readonly ChunkSetSummary[]> {
  validateIds(input.projectId, input.sessionId);
  const dir = sessionDir(input.storeRoot, input.projectId, input.sessionId);

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const summaries: ChunkSetSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (name === READ_INDEX_FILENAME) continue; // sibling index, not a chunk-set
    if (name === SHOWN_INDEX_FILENAME) continue; // sibling index, not a chunk-set
    const path = join(dir, name);
    const chunkSet = parseExistingFile(path, readFileSync(path, "utf8"));
    summaries.push({
      chunkSetId: chunkSet.chunkSetId,
      createdAt: chunkSet.createdAt,
      source: chunkSet.source,
      rawBytes: chunkSet.rawBytes,
      redacted: chunkSet.redacted,
      chunkCount: chunkSet.chunks.length,
    });
  }
  return summaries;
}

export async function deleteChunkSet(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): Promise<void> {
  validateIds(input.projectId, input.sessionId);
  const path = chunkSetPath(input);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new ContentStoreError("write_failed", `Delete failed: ${input.chunkSetId}`, {
      cause: error,
    });
  }
}

export async function deleteOverlayChunkSet(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  chunkSetId: string;
}): Promise<void> {
  const path = overlayChunkSetPath(input);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new ContentStoreError("write_failed", `Delete failed: ${input.chunkSetId}`, {
      cause: error,
    });
  }
}

export async function saveOverlayChunkSet(input: {
  storeRoot: string;
  chunkSet: OverlayChunkSet;
}): Promise<void> {
  let chunkSet: OverlayChunkSet;
  try {
    chunkSet = overlayChunkSetSchema.parse(input.chunkSet);
  } catch (error) {
    throw new ContentStoreError("schema_invalid", "ChunkSet is invalid.", { cause: error });
  }

  const path = overlayChunkSetPath({
    storeRoot: input.storeRoot,
    workspaceKey: chunkSet.workspaceKey,
    liveSessionId: chunkSet.liveSessionId,
    chunkSetId: chunkSet.chunkSetId,
  });

  atomicWriteFile(path, `${JSON.stringify(chunkSet, null, 2)}\n`);
}

export async function loadOverlayChunkSet(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  chunkSetId: string;
}): Promise<OverlayChunkSet> {
  const path = overlayChunkSetPath(input);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new ContentStoreError("not_found", `ChunkSet not found: ${input.chunkSetId}`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ContentStoreError("store_corrupt", `Corrupt chunkSet file: ${path}`, {
      cause: error,
    });
  }
  try {
    return overlayChunkSetSchema.parse(parsed);
  } catch (error) {
    throw new ContentStoreError("store_corrupt", `Corrupt chunkSet file: ${path}`, {
      cause: error,
    });
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Reads createdAt from either chunk-set layout; null = not a chunk set (leave it).
function readChunkSetCreatedAt(path: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const registry = chunkSetSchema.safeParse(json);
  if (registry.success) return registry.data.createdAt;
  const overlay = overlayChunkSetSchema.safeParse(json);
  if (overlay.success) return overlay.data.createdAt;
  return null;
}

export async function pruneOlderThan(input: {
  storeRoot: string;
  olderThan: Date;
}): Promise<{ removed: number }> {
  const contentRoot = join(input.storeRoot, "content");

  let topDirs: string[];
  try {
    topDirs = readdirSync(contentRoot);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { removed: 0 };
    throw error;
  }

  let removed = 0;
  for (const topDir of topDirs) {
    const topPath = join(contentRoot, topDir);
    if (!isDir(topPath)) continue; // .last-gc marker, .DS_Store
    for (const sessionDirName of readdirSync(topPath)) {
      const sessionPath = join(topPath, sessionDirName);
      if (!isDir(sessionPath)) continue;
      for (const name of readdirSync(sessionPath)) {
        if (!name.endsWith(".json")) continue;
        if (name === READ_INDEX_FILENAME) continue; // sibling index, not a chunk-set
        if (name === SHOWN_INDEX_FILENAME) continue; // sibling index, not a chunk-set
        const path = join(sessionPath, name);
        const createdAt = readChunkSetCreatedAt(path);
        if (createdAt === null) continue;
        if (new Date(createdAt) < input.olderThan) {
          rmSync(path, { force: true });
          removed += 1;
        }
      }
      // Housekeeping: drop dirs the prune emptied. rmdir refuses non-empty dirs
      // (read-index survivors, young sets) — that refusal IS the guard.
      try {
        rmdirSync(sessionPath);
      } catch (error) {
        if (!isErrno(error) || (error.code !== "ENOTEMPTY" && error.code !== "ENOENT")) throw error;
      }
    }
    try {
      rmdirSync(topPath);
    } catch (error) {
      if (!isErrno(error) || (error.code !== "ENOTEMPTY" && error.code !== "ENOENT")) throw error;
    }
  }
  return { removed };
}
