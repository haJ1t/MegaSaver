import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type HeartbeatStamp = { ts: string; workspaceKey: string };
export type HeartbeatView = {
  latest: HeartbeatStamp | null;
  latestCompression: HeartbeatStamp | null;
  workspaces: Record<string, string>;
};

const MAX_WORKSPACES = 256;
const TTL_MS = 30 * 86_400_000;
const FUTURE_SKEW_MS = 5 * 60_000;
const LOCK_WAIT_MS = 10;

function registryPath(storeRoot: string): string {
  return join(storeRoot, "stats", "saver-hook-heartbeats.json");
}

type RawRegistry = { latestCompression: HeartbeatStamp | null; workspaces: Record<string, string> };

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
      workspaces:
        parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {},
    };
  } catch {
    return empty();
  }
}
const empty = (): RawRegistry => ({ latestCompression: null, workspaces: {} });
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

// Prune (future-skew, TTL, 256-cap) and derive both latest fields. Pure — used by
// both the record path (result is persisted) and the non-mutating read path.
function computeView(raw: RawRegistry, now: number): HeartbeatView {
  const kept: Array<[string, number]> = [];
  for (const [wk, iso] of Object.entries(raw.workspaces)) {
    const t = ms(iso);
    if (valid(t, now)) kept.push([wk, t]);
  }
  kept.sort((a, b) => b[1] - a[1]); // newest first
  const capped = kept.slice(0, MAX_WORKSPACES);
  const workspaces: Record<string, string> = {};
  for (const [wk, t] of capped) workspaces[wk] = new Date(t).toISOString();

  const head = capped[0];
  const latest: HeartbeatStamp | null =
    head !== undefined ? { ts: new Date(head[1]).toISOString(), workspaceKey: head[0] } : null;

  const lc = raw.latestCompression;
  const latestCompression = lc !== null && valid(ms(lc.ts), now) ? lc : null;

  return { latest, latestCompression, workspaces };
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

// Non-blocking: try to grab a wx lock for up to ~10ms; skip (best-effort) if
// contended so a hook is never blocked or its tool result mutated.
function withHeartbeatLock(storeRoot: string, fn: () => void): void {
  const dir = join(storeRoot, "stats");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, ".saver-heartbeat.lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      closeSync(fd);
      break;
    } catch {
      if (Date.now() >= deadline) return; // contended → skip
    }
  }
  try {
    fn();
  } finally {
    try {
      rmSync(lock, { force: true });
    } catch {
      /* best-effort */
    }
  }
}
