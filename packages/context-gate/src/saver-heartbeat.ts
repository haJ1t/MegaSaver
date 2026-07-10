import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { withFileLock } from "@megasaver/shared";

export type HeartbeatStamp = { ts: string; workspaceKey: string };
export type FailureKind = "payload" | "resolve" | "record" | "unknown";
export type HeartbeatFailureEntry = { count: number; lastAt: string; lastKind: FailureKind };
export type HeartbeatFallbackEntry = { count: number; lastAt: string };
export type HeartbeatView = {
  latest: HeartbeatStamp | null;
  latestCompression: HeartbeatStamp | null;
  workspaces: Record<string, string>;
  completions?: Record<string, string>;
  failures?: Record<string, HeartbeatFailureEntry>;
  daemonFallbacks?: Record<string, HeartbeatFallbackEntry>;
};

const MAX_WORKSPACES = 256;
const TTL_MS = 30 * 86_400_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const LOCK_WAIT_MS = 10;
const LOCK_STALE_MS = 5000;
const FAILURE_KINDS: ReadonlySet<string> = new Set(["payload", "resolve", "record", "unknown"]);

function registryPath(storeRoot: string): string {
  return join(storeRoot, "stats", "saver-hook-heartbeats.json");
}

type RawRegistry = {
  latestCompression: HeartbeatStamp | null;
  workspaces: Record<string, string>;
  completions: Record<string, string>;
  failures: Record<string, HeartbeatFailureEntry>;
  daemonFallbacks: Record<string, HeartbeatFallbackEntry>;
};

function readRaw(storeRoot: string): RawRegistry {
  const path = registryPath(storeRoot);
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return empty();
  } catch {
    return empty();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<HeartbeatView>;
    return {
      latestCompression: isStamp(parsed.latestCompression) ? parsed.latestCompression : null,
      workspaces: sanitizeStringMap(parsed.workspaces),
      completions: sanitizeStringMap(parsed.completions),
      failures: sanitizeFailures(parsed.failures),
      daemonFallbacks: sanitizeFallbacks(parsed.daemonFallbacks),
    };
  } catch {
    return empty();
  }
}

// Boundary guard (§8): keep only string-valued entries so a corrupt registry
// (e.g. numeric values that Date.parse would coerce) cannot survive.
function sanitizeStringMap(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function sanitizeFailures(v: unknown): Record<string, HeartbeatFailureEntry> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, HeartbeatFailureEntry> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "object" || val === null) continue;
    const e = val as Partial<HeartbeatFailureEntry>;
    if (
      typeof e.count === "number" &&
      Number.isInteger(e.count) &&
      e.count >= 0 &&
      typeof e.lastAt === "string" &&
      typeof e.lastKind === "string" &&
      FAILURE_KINDS.has(e.lastKind)
    ) {
      out[k] = { count: e.count, lastAt: e.lastAt, lastKind: e.lastKind };
    }
  }
  return out;
}

function sanitizeFallbacks(v: unknown): Record<string, HeartbeatFallbackEntry> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, HeartbeatFallbackEntry> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "object" || val === null) continue;
    const e = val as Partial<HeartbeatFallbackEntry>;
    if (
      typeof e.count === "number" &&
      Number.isInteger(e.count) &&
      e.count >= 0 &&
      typeof e.lastAt === "string"
    ) {
      out[k] = { count: e.count, lastAt: e.lastAt };
    }
  }
  return out;
}

const empty = (): RawRegistry => ({
  latestCompression: null,
  workspaces: {},
  completions: {},
  failures: {},
  daemonFallbacks: {},
});

function isStamp(v: unknown): v is HeartbeatStamp {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as HeartbeatStamp).ts === "string" &&
    typeof (v as HeartbeatStamp).workspaceKey === "string"
  );
}

const ms = (iso: string): number => Date.parse(iso);
const valid = (t: number, now: number): boolean =>
  !Number.isNaN(t) && t <= now + FUTURE_SKEW_MS && t >= now - TTL_MS;

function pruneStringMap(map: Record<string, string>, now: number): Record<string, string> {
  const kept: Array<[string, number]> = [];
  for (const [wk, iso] of Object.entries(map)) {
    const t = ms(iso);
    if (valid(t, now)) kept.push([wk, t]);
  }
  kept.sort((a, b) => b[1] - a[1]); // newest first
  const out: Record<string, string> = {};
  for (const [wk, t] of kept.slice(0, MAX_WORKSPACES)) out[wk] = new Date(t).toISOString();
  return out;
}

function pruneEntryMap<T extends { lastAt: string }>(
  map: Record<string, T>,
  now: number,
): Record<string, T> {
  const kept: Array<[string, T, number]> = [];
  for (const [wk, entry] of Object.entries(map)) {
    const t = ms(entry.lastAt);
    if (valid(t, now)) kept.push([wk, entry, t]);
  }
  kept.sort((a, b) => b[2] - a[2]);
  const out: Record<string, T> = {};
  for (const [wk, entry] of kept.slice(0, MAX_WORKSPACES)) out[wk] = entry;
  return out;
}

// Prune every map independently (future-skew, TTL, 256-cap by its own
// timestamp) and derive both latest fields. Pure — used by the record path
// (result is persisted) and the non-mutating read path. Empty grown maps are
// omitted so a pre-wave-4 registry round-trips shape-compatibly.
function computeView(raw: RawRegistry, now: number): HeartbeatView {
  const workspaces = pruneStringMap(raw.workspaces, now);
  const completions = pruneStringMap(raw.completions, now);
  const failures = pruneEntryMap(raw.failures, now);
  const daemonFallbacks = pruneEntryMap(raw.daemonFallbacks, now);

  const newest = Object.entries(workspaces).sort((a, b) => ms(b[1]) - ms(a[1]))[0];
  const latest: HeartbeatStamp | null =
    newest !== undefined ? { ts: newest[1], workspaceKey: newest[0] } : null;

  const lc = raw.latestCompression;
  const latestCompression = lc !== null && valid(ms(lc.ts), now) ? lc : null;

  return {
    latest,
    latestCompression,
    workspaces,
    ...(Object.keys(completions).length > 0 ? { completions } : {}),
    ...(Object.keys(failures).length > 0 ? { failures } : {}),
    ...(Object.keys(daemonFallbacks).length > 0 ? { daemonFallbacks } : {}),
  };
}

export function readHeartbeatView(storeRoot: string, now: number = Date.now()): HeartbeatView {
  return computeView(readRaw(storeRoot), now);
}

export function recordInvocationHeartbeat(
  storeRoot: string,
  workspaceKey: string,
  tsIso: string,
  now: number = Date.now(),
): void {
  const t = ms(tsIso);
  if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return; // reject future skew / garbage
  withHeartbeatLock(storeRoot, () => {
    const raw = readRaw(storeRoot);
    const existing = raw.workspaces[workspaceKey]
      ? ms(raw.workspaces[workspaceKey])
      : Number.NEGATIVE_INFINITY;
    if (t <= existing) return; // strict-newer per key
    raw.workspaces[workspaceKey] = tsIso;
    persist(storeRoot, computeView(raw, now));
  });
}

export function recordCompressionHeartbeat(
  storeRoot: string,
  workspaceKey: string,
  tsIso: string,
  now: number = Date.now(),
): void {
  const t = ms(tsIso);
  if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return;
  withHeartbeatLock(storeRoot, () => {
    const raw = readRaw(storeRoot);
    const current = raw.latestCompression ? ms(raw.latestCompression.ts) : Number.NEGATIVE_INFINITY;
    if (t <= current) return; // strict-newer, never backward
    raw.latestCompression = { ts: tsIso, workspaceKey };
    persist(storeRoot, computeView(raw, now));
  });
}

// E21: completion proves the hook FINISHED; invocation only proves it fired.
// The gap between the two per workspace is the crash signal doctor reads.
export function recordCompletionHeartbeat(
  storeRoot: string,
  workspaceKey: string,
  tsIso: string,
  now: number = Date.now(),
): void {
  const t = ms(tsIso);
  if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return;
  withHeartbeatLock(storeRoot, () => {
    const raw = readRaw(storeRoot);
    const existing = raw.completions[workspaceKey]
      ? ms(raw.completions[workspaceKey])
      : Number.NEGATIVE_INFINITY;
    if (t <= existing) return; // strict-newer per key
    raw.completions[workspaceKey] = tsIso;
    persist(storeRoot, computeView(raw, now));
  });
}

// E21: count always increments (even for an out-of-order timestamp) so no
// failure is ever lost; lastAt/lastKind only move forward (strict-newer).
export function recordFailureHeartbeat(
  storeRoot: string,
  workspaceKey: string,
  kind: FailureKind,
  tsIso: string,
  now: number = Date.now(),
): void {
  const t = ms(tsIso);
  if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return;
  withHeartbeatLock(storeRoot, () => {
    const raw = readRaw(storeRoot);
    const prior = raw.failures[workspaceKey];
    raw.failures[workspaceKey] =
      prior !== undefined && ms(prior.lastAt) >= t
        ? { count: prior.count + 1, lastAt: prior.lastAt, lastKind: prior.lastKind }
        : { count: (prior?.count ?? 0) + 1, lastAt: tsIso, lastKind: kind };
    persist(storeRoot, computeView(raw, now));
  });
}

export function recordDaemonFallbackHeartbeat(
  storeRoot: string,
  workspaceKey: string,
  tsIso: string,
  now: number = Date.now(),
): void {
  const t = ms(tsIso);
  if (Number.isNaN(t) || t > now + FUTURE_SKEW_MS) return;
  withHeartbeatLock(storeRoot, () => {
    const raw = readRaw(storeRoot);
    const prior = raw.daemonFallbacks[workspaceKey];
    raw.daemonFallbacks[workspaceKey] =
      prior !== undefined && ms(prior.lastAt) >= t
        ? { count: prior.count + 1, lastAt: prior.lastAt }
        : { count: (prior?.count ?? 0) + 1, lastAt: tsIso };
    persist(storeRoot, computeView(raw, now));
  });
}

function persist(storeRoot: string, view: HeartbeatView): void {
  const path = registryPath(storeRoot);
  const dir = join(storeRoot, "stats");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${randomUUID()}.hb.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify({ version: 1, ...view }), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* already renamed */
    }
  }
}

// E25: stale-aware lock. A dead holder's lock file (mtime older than
// LOCK_STALE_MS) is stolen instead of freezing liveness telemetry forever;
// a FRESH contended lock still skips within LOCK_WAIT_MS (best-effort — a
// hook is never blocked and its tool result never delayed).
function withHeartbeatLock(storeRoot: string, fn: () => void): void {
  const dir = join(storeRoot, "stats");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  withFileLock(
    join(dir, ".saver-heartbeat.lock"),
    { deadlineMs: LOCK_WAIT_MS, staleMs: LOCK_STALE_MS },
    fn,
  );
}
