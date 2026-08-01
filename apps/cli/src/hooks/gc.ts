import { randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { pruneOlderThan } from "@megasaver/content-store";
import { pruneChunkSetsHonoringPins, sweepEvidenceStore } from "@megasaver/context-gate";
import { reconcileOverlaySummaries } from "@megasaver/core";

export const OVERLAY_RETENTION_MS = 30 * 86_400_000;
export const GC_INTERVAL_MS = 86_400_000;

export type GcDeps = {
  now?: () => number;
  prune?: typeof pruneOlderThan;
};

function isOrdinaryDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function gcMarkerPaths(storeRoot: string): string[] {
  return [join(storeRoot, "content"), join(storeRoot, "stats")]
    .filter(isOrdinaryDirectory)
    .map((directory) => join(directory, ".last-gc"));
}

function markerMtime(path: string): number | undefined {
  try {
    const marker = lstatSync(path);
    return marker.isFile() ? marker.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

function stampGcMarkers(paths: readonly string[], now: number): boolean {
  let stamped = false;
  const stamp = new Date(now);
  for (const marker of paths) {
    const directory = dirname(marker);
    const temporary = join(directory, `.${randomUUID()}.last-gc`);
    let descriptor: number | undefined;
    try {
      if (!isOrdinaryDirectory(directory)) continue;
      descriptor = openSync(temporary, "wx", 0o600);
      writeSync(descriptor, "");
      closeSync(descriptor);
      descriptor = undefined;
      utimesSync(temporary, stamp, stamp);
      if (!isOrdinaryDirectory(directory)) continue;
      renameSync(temporary, marker);
      stamped = true;
    } catch {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the marker write failure below.
        }
      }
      try {
        rmSync(temporary, { force: true });
      } catch {
        // A marker on another ordinary store directory can still throttle GC.
      }
    }
  }
  return stamped;
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

function pruneTaskKickoffFiles(storeRoot: string, cutoffMs: number): void {
  const statsDirectory = join(storeRoot, "stats");
  if (!isOrdinaryDirectory(statsDirectory)) return;
  let workspaces: string[];
  try {
    workspaces = readdirSync(statsDirectory);
  } catch {
    return;
  }
  for (const ws of workspaces) {
    const workspaceDirectory = join(statsDirectory, ws);
    if (!isOrdinaryDirectory(workspaceDirectory)) continue;
    const dir = join(workspaceDirectory, "task-pack");
    if (!isOrdinaryDirectory(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      // Retention only: this never interprets a claim age as permission to
      // steal a live session's emission guard.
      if (!f.endsWith(".json") && !f.endsWith(".json.claim")) continue;
      const p = join(dir, f);
      try {
        const entry = lstatSync(p);
        if (entry.isFile() && entry.mtimeMs < cutoffMs) unlinkSync(p);
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
  const hasContent = isOrdinaryDirectory(join(storeRoot, "content"));
  const markers = gcMarkerPaths(storeRoot);
  if (markers.length === 0) return false;
  const currentNow = now();
  const markerMtimes = markers
    .map(markerMtime)
    .filter((mtime): mtime is number => mtime !== undefined);
  const latestMarker = Math.max(Number.NEGATIVE_INFINITY, ...markerMtimes);
  if (currentNow - latestMarker < GC_INTERVAL_MS) return false;
  if (!stampGcMarkers(markers, currentNow)) return false;
  try {
    if (hasContent) {
      await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
      pruneIntentFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
    }
    pruneTaskKickoffFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
    if (hasContent) {
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
    }
    return true;
  } catch {
    return false;
  }
}
