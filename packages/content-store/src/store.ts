import { readFileSync, readdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type ProjectId,
  type SessionId,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";
import {
  type ChunkSet,
  type ChunkSetSummary,
  type OverlayChunkSet,
  chunkSetSchema,
  overlayChunkSetSchema,
} from "./chunk-set.js";
import { ContentStoreError } from "./errors.js";
import { assertSafeSegment, chunkSetPath, overlayChunkSetPath } from "./paths.js";

export const READ_INDEX_FILENAME = "read-index.json";
export const SHOWN_INDEX_FILENAME = "shown-index.json";
export const CAPSULE_FILENAME = "work-state-capsule.json";
export const PREFLIGHT_FILENAME_RE = /^preflight-\d+-[a-z0-9]{6}\.json$/;

export function isPreflightFilename(name: string): boolean {
  return PREFLIGHT_FILENAME_RE.test(name);
}

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
    if (name === CAPSULE_FILENAME) continue; // reserved capsule sibling, not a chunk-set
    if (isPreflightFilename(name)) continue; // reserved preflight sibling, not a chunk-set
    if (isForkFilename(name)) continue; // reserved fork sibling, not a chunk-set
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

export async function listOverlayChunkSets(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
}): Promise<readonly ChunkSetSummary[]> {
  assertSafeSegment(input.workspaceKey);
  assertSafeSegment(input.liveSessionId);
  const dir = join(input.storeRoot, "content", input.workspaceKey, input.liveSessionId);
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
    if (name === CAPSULE_FILENAME) continue; // reserved capsule sibling, not a chunk-set
    if (isPreflightFilename(name)) continue; // reserved preflight sibling, not a chunk-set
    if (isForkFilename(name)) continue; // reserved fork sibling, not a chunk-set
    const path = join(dir, name);
    let chunkSet: OverlayChunkSet;
    try {
      chunkSet = overlayChunkSetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      throw new ContentStoreError("store_corrupt", `Invalid chunk-set: ${name}`, { cause: error });
    }
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

// A chunk file's address. Chunk-set ids are content-derived on the saver path,
// so the same id names a different file in every session dir that produced the
// same output — only the whole triple identifies one file. Ids never contain
// "/", so a scoped key can never be mistaken for a bare id.
export function chunkSetKey(input: {
  topDir: string;
  sessionDir: string;
  chunkSetId: string;
}): string {
  return `${input.topDir}/${input.sessionDir}/${input.chunkSetId}`;
}

export async function pruneOlderThan(input: {
  storeRoot: string;
  olderThan: Date;
  // Chunk sets an evidence hold still points at (pinned / manual_hold), as
  // chunkSetKey values. The store cannot read the ledger (no dep edge), so the
  // composer joins them and hands the keys down — see @megasaver/context-gate
  // pruneChunkSetsHonoringPins. A hold whose scope the composer could not
  // resolve arrives as a bare id and matches every copy: over-retaining is the
  // safe failure for a hold, deleting is not.
  keepChunkSetKeys?: ReadonlySet<string>;
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
        if (name === CAPSULE_FILENAME) continue; // reserved capsule sibling, not a chunk-set
        if (isPreflightFilename(name)) continue; // reserved preflight sibling, not a chunk-set
        if (isForkFilename(name)) continue; // reserved fork sibling, not a chunk-set
        const chunkSetId = name.slice(0, -".json".length);
        if (
          input.keepChunkSetKeys?.has(
            chunkSetKey({ topDir, sessionDir: sessionDirName, chunkSetId }),
          ) ||
          input.keepChunkSetKeys?.has(chunkSetId)
        ) {
          continue;
        }
        const path = join(sessionPath, name);
        // Chunk sets are write-once (atomicWriteFile), so mtime tracks createdAt
        // and answers "is this young?" without reading the body — which holds a
        // whole stored tool output. The sweep runs inside the PostToolUse hook
        // and retains ~30x what it deletes, so the retained files are the
        // workload. Same stat-gate shape as pruneIntentFiles / pruneSeenFiles
        // (apps/cli/src/hooks/gc.ts). A file touched after it was written is
        // kept, not deleted: mtime can only over-state age-since-write.
        let mtimeMs: number;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        if (mtimeMs >= input.olderThan.getTime()) continue;
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

export const FORK_FILENAME_RE = /^fork-\d+-[a-z0-9]{6}\.json$/;

export function isForkFilename(name: string): boolean {
  return FORK_FILENAME_RE.test(name);
}

export const preflightSnapshotSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.string().regex(/^preflight-\d+-[a-z0-9]{6}$/),
    createdAt: z.string().datetime({ offset: true }),
    workspaceKey: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    projectId: z.string().optional(),
    label: z.string().optional(),
    git: z
      .object({
        available: z.boolean(),
        headOid: z.string().nullable(),
        branch: z.string().nullable(),
        staged: z.array(z.object({ path: z.string(), status: z.string(), hash: z.string() })),
        unstaged: z.array(z.object({ path: z.string(), status: z.string(), hash: z.string() })),
        untracked: z.array(z.string()),
        reason: z.string().optional(),
      })
      .strict(),
    counters: z
      .object({
        staged: z.number().int().nonnegative(),
        unstaged: z.number().int().nonnegative(),
        untracked: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PreflightSnapshot = z.infer<typeof preflightSnapshotSchema>;

export async function listPreflightSnapshots(input: {
  storeRoot: string;
  workspaceKey?: string;
  liveSessionId?: string;
  projectId?: string;
  sessionId?: string;
}): Promise<readonly { snapshotId: string; path: string; createdAt: string }[]> {
  const dirs: string[] = [];
  if (input.workspaceKey && input.liveSessionId) {
    dirs.push(join(input.storeRoot, "content", input.workspaceKey, input.liveSessionId));
  } else if (input.projectId && input.sessionId) {
    dirs.push(join(input.storeRoot, "content", input.projectId, input.sessionId));
  } else if (input.workspaceKey) {
    const top = join(input.storeRoot, "content", input.workspaceKey);
    try {
      for (const entry of readdirSync(top)) {
        const p = join(top, entry);
        try {
          if (statSync(p).isDirectory()) dirs.push(p);
        } catch {}
      }
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") return [];
      throw error;
    }
  } else if (input.projectId) {
    const top = join(input.storeRoot, "content", input.projectId);
    try {
      for (const entry of readdirSync(top)) {
        const p = join(top, entry);
        try {
          if (statSync(p).isDirectory()) dirs.push(p);
        } catch {}
      }
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") return [];
      throw error;
    }
  } else {
    return [];
  }

  const results: { snapshotId: string; path: string; createdAt: string }[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") continue;
      throw error;
    }
    for (const name of names) {
      if (!isPreflightFilename(name)) continue;
      const path = join(dir, name);
      try {
        const raw = readFileSync(path, "utf8");
        const json = JSON.parse(raw);
        const parsed = preflightSnapshotSchema.safeParse(json);
        if (!parsed.success) continue;
        results.push({
          snapshotId: parsed.data.snapshotId,
          path,
          createdAt: parsed.data.createdAt,
        });
      } catch {}
    }
  }
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
}

export function readPreflightSnapshot(path: string): PreflightSnapshot | null {
  try {
    const raw = readFileSync(path, "utf8");
    const json = JSON.parse(raw);
    const parsed = preflightSnapshotSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
