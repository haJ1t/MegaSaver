import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  futimesSync,
  lstatSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { pruneOlderThan } from "@megasaver/content-store";
import { pruneChunkSetsHonoringPins, sweepEvidenceStore } from "@megasaver/context-gate";
import { reconcileOverlaySummaries } from "@megasaver/core";
import { workspaceKeySchema } from "@megasaver/shared";
import {
  prepareCacheAdviceGcRootDirectory,
  prepareTaskKickoffStoreRootDirectory,
  resolveTaskKickoffStoreDependencies,
} from "./task-kickoff-store-fs.js";

export const OVERLAY_RETENTION_MS = 30 * 86_400_000;
export const GC_INTERVAL_MS = 86_400_000;

export type GcDeps = {
  now?: () => number;
  prune?: typeof pruneOlderThan;
};

export type CacheAdviceGcDeps = {
  now?: () => number;
  platform?: NodeJS.Platform;
};

const CACHE_ADVICE_GC_MARKER = ".last-cache-advice-gc";
const CACHE_ADVICE_ENTRY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:json|lock)$/;
const CACHE_ADVICE_TRANSACTION_TEMP =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
type CacheAdviceGcLock = { descriptor: number; dev: number; ino: number };

function effectiveUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("cache advice GC requires a POSIX user id");
  return uid;
}

function privateDirectory(path: string, uid: number): boolean {
  const stats = lstatSync(path);
  return stats.isDirectory() && stats.uid === uid && (stats.mode & 0o077) === 0;
}

function acquireCacheAdviceGcLock(path: string, uid: number): CacheAdviceGcLock | null {
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
  } catch {
    return null;
  }
  try {
    fchmodSync(descriptor, 0o600);
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
      throw new Error("cache advice GC lock is unsafe");
    }
    fsyncSync(descriptor);
    return { descriptor, dev: stats.dev, ino: stats.ino };
  } catch {
    try {
      closeSync(descriptor);
    } catch {
      // Best-effort housekeeping must never affect the hook result.
    }
    try {
      unlinkSync(path);
    } catch {
      // Best-effort housekeeping must never affect the hook result.
    }
    return null;
  }
}

function releaseCacheAdviceGcLock(path: string, lock: CacheAdviceGcLock, uid: number): void {
  try {
    closeSync(lock.descriptor);
  } catch {
    return;
  }
  try {
    const stats = lstatSync(path);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.uid !== uid ||
      stats.dev !== lock.dev ||
      stats.ino !== lock.ino
    ) {
      return;
    }
    unlinkSync(path);
  } catch {
    // Best-effort housekeeping must never affect the hook result.
  }
}

function pruneOldCacheAdviceLock(path: string, cutoffMs: number, uid: number): boolean {
  try {
    const stats = lstatSync(path);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.uid !== uid ||
      (stats.mode & 0o077) !== 0 ||
      stats.mtimeMs >= cutoffMs
    ) {
      return false;
    }
    const current = lstatSync(path);
    if (current.dev !== stats.dev || current.ino !== stats.ino || current.nlink !== 1) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function pruneOldCacheAdviceTransactionTemp(path: string, cutoffMs: number, uid: number): void {
  try {
    const stats = lstatSync(path);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.uid !== uid ||
      (stats.mode & 0o077) !== 0 ||
      stats.mtimeMs >= cutoffMs
    ) {
      return;
    }
    const current = lstatSync(path);
    if (current.dev !== stats.dev || current.ino !== stats.ino || current.nlink !== 1) return;
    unlinkSync(path);
  } catch {
    // Best-effort housekeeping must never affect the hook result.
  }
}

function pruneCacheAdviceState(
  cacheAdviceDirectory: string,
  entry: string,
  cutoffMs: number,
  uid: number,
): void {
  const path = join(cacheAdviceDirectory, entry);
  const sessionId = entry.slice(0, -".json".length);
  const lockPath = join(cacheAdviceDirectory, `${sessionId}.lock`);
  let lock = acquireCacheAdviceGcLock(lockPath, uid);
  if (lock === null && pruneOldCacheAdviceLock(lockPath, cutoffMs, uid)) {
    lock = acquireCacheAdviceGcLock(lockPath, uid);
  }
  if (lock === null) return;
  try {
    const stats = lstatSync(path);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.uid !== uid ||
      (stats.mode & 0o077) !== 0 ||
      stats.mtimeMs >= cutoffMs
    ) {
      return;
    }
    const current = lstatSync(path);
    if (current.dev !== stats.dev || current.ino !== stats.ino || current.nlink !== 1) return;
    unlinkSync(path);
  } catch {
    // Best-effort housekeeping must never affect the hook result.
  } finally {
    releaseCacheAdviceGcLock(lockPath, lock, uid);
  }
}

async function claimCacheAdviceGc(
  statsDirectory: string,
  at: number,
  uid: number,
): Promise<boolean> {
  const marker = join(statsDirectory, CACHE_ADVICE_GC_MARKER);
  let existed = true;
  let expectedIdentity: { dev: number; ino: number } | undefined;
  try {
    const stats = lstatSync(marker);
    if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
      return false;
    }
    if (at - stats.mtimeMs < GC_INTERVAL_MS) {
      return false;
    }
    expectedIdentity = { dev: stats.dev, ino: stats.ino };
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      return false;
    }
    existed = false;
  }

  let descriptor: number;
  try {
    descriptor = openSync(
      marker,
      existed
        ? constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        : constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK,
      0o600,
    );
  } catch {
    return false;
  }

  try {
    fchmodSync(descriptor, 0o600);
    const stats = fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.uid !== uid ||
      (expectedIdentity !== undefined &&
        (stats.dev !== expectedIdentity.dev || stats.ino !== expectedIdentity.ino))
    ) {
      return false;
    }
    const stamp = new Date(at);
    futimesSync(descriptor, stamp, stamp);
    fsyncSync(descriptor);
  } catch {
    return false;
  } finally {
    closeSync(descriptor);
  }
  try {
    await resolveTaskKickoffStoreDependencies().syncDirectory(statsDirectory);
  } catch {
    return false;
  }
  return true;
}

function pruneCacheAdviceFiles(statsDirectory: string, cutoffMs: number, uid: number): void {
  let workspaces: string[];
  try {
    workspaces = readdirSync(statsDirectory);
  } catch {
    return;
  }
  for (const workspaceKey of workspaces) {
    if (!workspaceKeySchema.safeParse(workspaceKey).success) continue;
    const workspaceDirectory = join(statsDirectory, workspaceKey);
    const cacheAdviceDirectory = join(workspaceDirectory, "cache-advice");
    try {
      if (
        !privateDirectory(workspaceDirectory, uid) ||
        !privateDirectory(cacheAdviceDirectory, uid)
      ) {
        continue;
      }
    } catch {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(cacheAdviceDirectory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (CACHE_ADVICE_TRANSACTION_TEMP.test(entry)) {
        pruneOldCacheAdviceTransactionTemp(join(cacheAdviceDirectory, entry), cutoffMs, uid);
        continue;
      }
      if (!CACHE_ADVICE_ENTRY.test(entry)) continue;
      if (entry.endsWith(".json")) {
        pruneCacheAdviceState(cacheAdviceDirectory, entry, cutoffMs, uid);
        continue;
      }
      const path = join(cacheAdviceDirectory, entry);
      pruneOldCacheAdviceLock(path, cutoffMs, uid);
    }
  }
}

export async function maybeRunCacheAdviceGc(
  storeRoot: string,
  deps: CacheAdviceGcDeps = {},
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") return false;
  const now = deps.now ?? Date.now;
  try {
    const dependencies = resolveTaskKickoffStoreDependencies();
    await prepareTaskKickoffStoreRootDirectory(storeRoot, platform, dependencies);
    const statsDirectory = await prepareCacheAdviceGcRootDirectory(
      storeRoot,
      platform,
      dependencies,
    );
    const uid = effectiveUserId();
    const at = now();
    if (!(await claimCacheAdviceGc(statsDirectory, at, uid))) return false;
    pruneCacheAdviceFiles(statsDirectory, at - OVERLAY_RETENTION_MS, uid);
    return true;
  } catch {
    return false;
  }
}

// D17: per-session intent files are tiny but unbounded; sweep them with the
// same retention as chunk sets. Best-effort, every failure swallowed.
function pruneIntentFiles(storeRoot: string, cutoffMs: number): void {
  let workspaces: string[];
  try {
    workspaces = readdirSync(join(storeRoot, "stats"));
  } catch {
    return;
  }
  for (const ws of workspaces) {
    const dir = join(storeRoot, "stats", ws, "intent");
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      try {
        if (statSync(p).mtimeMs < cutoffMs) unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}

// P1 first-sight ledger: one seen-hash file per session, unbounded file count;
// sweep with the same retention as intent files. Best-effort, every failure swallowed.
function pruneSeenFiles(storeRoot: string, cutoffMs: number): void {
  let workspaces: string[];
  try {
    workspaces = readdirSync(join(storeRoot, "stats"));
  } catch {
    return;
  }
  for (const ws of workspaces) {
    const dir = join(storeRoot, "stats", ws, "saver-seen");
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      try {
        if (statSync(p).mtimeMs < cutoffMs) unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}

// Throttled, best-effort content-store GC (C14). The marker is touched BEFORE
// pruning so a hook arriving AFTER the touch skips the walk. A simultaneous
// check-then-claim race (two hooks in the statSync→write window) can still both
// prune the same day — benign: pruneOlderThan is force/ENOENT-tolerant and any
// cross-process fs race is swallowed here, so the worst case is redundant work.
// Every failure path returns false without throwing — housekeeping, not
// correctness (pruneTraceSessions precedent). True only when a prune completed.
export async function maybeRunOverlayGc(storeRoot: string, deps: GcDeps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const prune = deps.prune ?? pruneChunkSetsHonoringPins;
  const marker = join(storeRoot, "content", ".last-gc");
  try {
    const mtime = statSync(marker).mtimeMs;
    if (now() - mtime < GC_INTERVAL_MS) return false;
  } catch {
    // Marker absent: claim it below. If content/ itself is absent the write
    // throws and there is nothing to prune anyway (returns false below).
  }
  try {
    const stamp = new Date(now());
    writeFileSync(marker, "");
    utimesSync(marker, stamp, stamp); // stamp with the injected clock, not wall time
  } catch {
    return false;
  }
  try {
    await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
    pruneIntentFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
    pruneSeenFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
    // Evidence rows outlive the chunk sets they point at unless the ledger is
    // swept on the same daily clock; nothing else calls gcEvidence.
    try {
      await sweepEvidenceStore({ storeRoot, now: new Date(now()) });
    } catch {
      /* best-effort */
    }
    // E26 drift repair: summaries lagging their JSONL (lock-skipped updates)
    // or failing schema are rebuilt in the same daily sweep. Best-effort.
    try {
      reconcileOverlaySummaries({ root: storeRoot });
    } catch {
      /* best-effort */
    }
    return true;
  } catch {
    return false;
  }
}
