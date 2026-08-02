import {
  constants,
  type Stats,
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
import {
  cacheAdviceRecordDirectory,
  readCacheAdviceQueueProgress,
  sweepCacheAdviceBatch,
} from "./cache-advice-queue.js";
import {
  prepareCacheAdviceV3Directory,
  prepareTaskKickoffStoreRootDirectory,
  resolveTaskKickoffStoreDependencies,
} from "./task-kickoff-store-fs.js";

export const OVERLAY_RETENTION_MS = 30 * 86_400_000;
export const GC_INTERVAL_MS = 86_400_000;
export const CACHE_ADVICE_GC_BATCH_SIZE = 8;
export const MAX_CACHE_ADVICE_GC_CLOCK_JUMP_MS = 2 * GC_INTERVAL_MS;

export type GcDeps = {
  now?: () => number;
  prune?: typeof pruneOlderThan;
};

export type CacheAdviceGcDeps = {
  now?: () => number;
  platform?: NodeJS.Platform;
};

const CACHE_ADVICE_GC_MARKER = ".last-cache-advice-gc";
const CACHE_ADVICE_GC_CLOCK_CUT = ".cache-advice-gc-clock-cut";
const CACHE_ADVICE_GC_GATE = ".gc.lock";
type CacheAdviceGcLock = { descriptor: number; dev: number; ino: number };
type PrivateFileSnapshot = { dev: number; ino: number; mtimeMs: number };
type PruneResult = "removed" | "retained" | "unsafe";
type ClockCutStatus = "missing" | "active" | "expired" | null;

function effectiveUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("cache advice GC requires a POSIX user id");
  return uid;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function requirePrivateRegularFile(stats: Stats, uid: number): PrivateFileSnapshot {
  if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
    throw new Error("cache advice GC node is unsafe");
  }
  return { dev: stats.dev, ino: stats.ino, mtimeMs: stats.mtimeMs };
}

function samePrivateFile(left: PrivateFileSnapshot, right: PrivateFileSnapshot): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function privateFileSnapshot(path: string, uid: number): PrivateFileSnapshot | undefined {
  let descriptor: number | undefined;
  try {
    const named = requirePrivateRegularFile(lstatSync(path), uid);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = requirePrivateRegularFile(fstatSync(descriptor), uid);
    if (!samePrivateFile(named, opened)) {
      throw new Error("cache advice GC node changed during open");
    }
    return opened;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort housekeeping must never affect the hook result.
      }
    }
  }
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
    return null;
  }
}

function releaseCacheAdviceGcLock(path: string, lock: CacheAdviceGcLock, uid: number): boolean {
  try {
    closeSync(lock.descriptor);
  } catch {
    return false;
  }
  try {
    const snapshot = privateFileSnapshot(path, uid);
    if (snapshot === undefined || snapshot.dev !== lock.dev || snapshot.ino !== lock.ino) {
      return false;
    }
    unlinkSync(path);
    return true;
  } catch {
    // Best-effort housekeeping must never affect the hook result.
    return false;
  }
}

function normalizeFutureTimestamp(
  path: string,
  expected: PrivateFileSnapshot,
  at: number,
  uid: number,
): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const current = requirePrivateRegularFile(fstatSync(descriptor), uid);
    if (!samePrivateFile(current, expected)) return false;
    if (current.mtimeMs <= at) return true;
    const stamp = new Date(at);
    futimesSync(descriptor, stamp, stamp);
    fsyncSync(descriptor);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort housekeeping must never affect the hook result.
      }
    }
  }
}

function pruneExpiredPrivateFile(
  path: string,
  cutoffMs: number,
  at: number,
  uid: number,
): PruneResult {
  try {
    const snapshot = privateFileSnapshot(path, uid);
    if (snapshot === undefined) return "retained";
    if (snapshot.mtimeMs > at) {
      return normalizeFutureTimestamp(path, snapshot, at, uid) ? "retained" : "unsafe";
    }
    if (snapshot.mtimeMs >= cutoffMs) return "retained";
    const current = privateFileSnapshot(path, uid);
    if (current === undefined || !samePrivateFile(current, snapshot)) return "unsafe";
    unlinkSync(path);
    return "removed";
  } catch {
    return "unsafe";
  }
}

function acquireSweepLock(
  path: string,
  cutoffMs: number,
  at: number,
  uid: number,
): CacheAdviceGcLock | null {
  let lock = acquireCacheAdviceGcLock(path, uid);
  if (lock !== null) return lock;
  if (pruneExpiredPrivateFile(path, cutoffMs, at, uid) !== "removed") return null;
  lock = acquireCacheAdviceGcLock(path, uid);
  return lock;
}

function stampPrivateFile(path: string, at: number, uid: number): boolean {
  let expected: PrivateFileSnapshot | undefined;
  try {
    expected = privateFileSnapshot(path, uid);
  } catch {
    return false;
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      expected === undefined
        ? constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK
        : constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    const current = requirePrivateRegularFile(fstatSync(descriptor), uid);
    if (expected !== undefined && !samePrivateFile(current, expected)) return false;
    const stamp = new Date(at);
    futimesSync(descriptor, stamp, stamp);
    fsyncSync(descriptor);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort housekeeping must never affect the hook result.
      }
    }
  }
}

function clockCutStatus(statsDirectory: string, at: number, uid: number): ClockCutStatus {
  try {
    const cut = privateFileSnapshot(join(statsDirectory, CACHE_ADVICE_GC_CLOCK_CUT), uid);
    if (cut === undefined) return "missing";
    if (cut.mtimeMs > at) {
      if (
        !normalizeFutureTimestamp(join(statsDirectory, CACHE_ADVICE_GC_CLOCK_CUT), cut, at, uid)
      ) {
        return null;
      }
      return "active";
    }
    return at - cut.mtimeMs < OVERLAY_RETENTION_MS ? "active" : "expired";
  } catch {
    return null;
  }
}

function needsClockCut(marker: PrivateFileSnapshot, at: number): boolean {
  return marker.mtimeMs > at || at - marker.mtimeMs > MAX_CACHE_ADVICE_GC_CLOCK_JUMP_MS;
}

function establishClockBaseline(
  statsDirectory: string,
  markerPath: string,
  at: number,
  uid: number,
): boolean {
  const cutStamped = stampPrivateFile(join(statsDirectory, CACHE_ADVICE_GC_CLOCK_CUT), at, uid);
  const markerStamped = cutStamped && stampPrivateFile(markerPath, at, uid);
  return cutStamped || markerStamped;
}

function sweepCacheAdviceFrame(
  storeRoot: string,
  recordId: string,
  cutoffMs: number,
  at: number,
  uid: number,
): "advance" | "requeue" | "suppress" {
  const capsuleDirectory = cacheAdviceRecordDirectory(storeRoot, recordId);
  const statePath = join(capsuleDirectory, "state.json");
  const suppressionPath = join(capsuleDirectory, "suppression.json");
  try {
    const state = privateFileSnapshot(statePath, uid);
    if (state !== undefined) {
      if (privateFileSnapshot(join(capsuleDirectory, "state.lock"), uid) !== undefined) {
        return "requeue";
      }
      const outcome = pruneExpiredPrivateFile(statePath, cutoffMs, at, uid);
      return outcome === "removed" ? "advance" : "requeue";
    }
    if (privateFileSnapshot(suppressionPath, uid) !== undefined) {
      const outcome = pruneExpiredPrivateFile(suppressionPath, cutoffMs, at, uid);
      return outcome === "removed" ? "advance" : "requeue";
    }
    return "advance";
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "requeue";
    return "suppress";
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
    const statsDirectory = await prepareCacheAdviceV3Directory(storeRoot, platform, dependencies);
    const uid = effectiveUserId();
    const at = now();
    if (!Number.isFinite(at)) return false;
    const cutoffMs = at - OVERLAY_RETENTION_MS;
    const queueRoot = join(storeRoot, "stats", "cache-advice-v3");
    const markerPath = join(statsDirectory, CACHE_ADVICE_GC_MARKER);
    const sweepLockPath = join(statsDirectory, CACHE_ADVICE_GC_GATE);
    const preflightMarker = privateFileSnapshot(markerPath, uid);
    const preflightQueueMarker = privateFileSnapshot(join(queueRoot, CACHE_ADVICE_GC_MARKER), uid);
    const preflightClockCut = clockCutStatus(statsDirectory, at, uid);
    if (preflightClockCut === null) return false;
    if (preflightMarker === undefined || needsClockCut(preflightMarker, at)) {
      if (establishClockBaseline(statsDirectory, markerPath, at, uid)) {
        await dependencies.syncDirectory(statsDirectory);
      }
      return false;
    }
    if (preflightClockCut === "active") {
      if (stampPrivateFile(markerPath, at, uid)) {
        await dependencies.syncDirectory(statsDirectory);
      }
      return false;
    }
    const queueProgress = await readCacheAdviceQueueProgress(storeRoot);
    const pacingMarker =
      queueProgress?.sweepActive && preflightQueueMarker !== undefined
        ? preflightQueueMarker
        : preflightMarker;
    const gateReference = queueProgress?.sweepActive
      ? Math.max(pacingMarker.mtimeMs, queueProgress.lastCompletedAt ?? 0)
      : pacingMarker.mtimeMs;
    if (at - gateReference < GC_INTERVAL_MS) return false;
    const sweepLock = acquireSweepLock(sweepLockPath, cutoffMs, at, uid);
    if (sweepLock === null) return false;
    let completed = false;
    let wroteControlFiles = false;
    try {
      const marker = privateFileSnapshot(markerPath, uid);
      const clockCut = clockCutStatus(statsDirectory, at, uid);
      if (clockCut === null) return false;
      if (marker === undefined || needsClockCut(marker, at)) {
        wroteControlFiles = establishClockBaseline(statsDirectory, markerPath, at, uid);
      } else if (clockCut === "active") {
        wroteControlFiles = stampPrivateFile(markerPath, at, uid);
      } else if (at - marker.mtimeMs >= GC_INTERVAL_MS) {
        const swept = await sweepCacheAdviceBatch({
          storeRoot,
          now: at,
          batchSize: CACHE_ADVICE_GC_BATCH_SIZE,
          processFrame: (recordId) =>
            Promise.resolve(sweepCacheAdviceFrame(storeRoot, recordId, cutoffMs, at, uid)),
        });
        if (swept === "completed") {
          wroteControlFiles = stampPrivateFile(markerPath, at, uid);
          completed = wroteControlFiles;
        } else if (swept === "incomplete") {
          // A multi-day sweep must pace daily batches without touching the
          // completion marker; progress is journaled in queue/control.json.
          const queueMarker = join(queueRoot, CACHE_ADVICE_GC_MARKER);
          if (stampPrivateFile(queueMarker, at, uid)) {
            await dependencies.syncDirectory(queueRoot);
          }
        }
      }
    } finally {
      if (!releaseCacheAdviceGcLock(sweepLockPath, sweepLock, uid)) completed = false;
    }
    if (wroteControlFiles) {
      await dependencies.syncDirectory(statsDirectory);
    }
    return completed;
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
