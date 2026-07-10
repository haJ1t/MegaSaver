# Saver Observability (Wave 4, E21–E29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task in the current session (or superpowers:executing-plans in a fresh one). Every task is RED test → minimal GREEN code → commit. Do not batch tasks; do not skip RED.

**Goal:** A dead saver must be visible. Hook failures, completions, and daemon fallbacks become countable ledger entries; corrupt overlay summaries self-heal; the heartbeat and summary locks become stale-aware; `mega hooks install` registers absolute, timeout-guarded, store-baked commands; `mega doctor` verifies the saver end-to-end; `mega hooks status` resolves overlay sessions and aggregates across workspaces. Spec: `docs/superpowers/specs/2026-07-10-saver-observability-design.md` (approved, risk HIGH).

**Architecture:** heartbeat-spine. The existing per-workspace heartbeat registry (`packages/context-gate/src/saver-heartbeat.ts`, persisted at `<store>/stats/saver-hook-heartbeats.json`) becomes the single liveness/failure ledger — every fix either writes to it, reads from it, or hardens an existing primitive (locks, summaries, install commands). No new subsystem.

**Tech Stack:** TypeScript strict ESM (NodeNext), Node 22, pnpm workspaces + Turborepo, Vitest, Biome, Zod at boundaries, Citty CLI. Packages touched in build order: `@megasaver/shared` → `@megasaver/context-gate` → `@megasaver/stats` → `@megasaver/core` (re-export only) → `@megasaver/connector-claude-code` → `@megasaver/cli`.

---

## Environment & verification discipline (READ FIRST)

- **Worktree:** all work happens in `/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-observability` (branch `feat/saver-observability`). Never edit `main`.
- **A live saver hook compresses tool outputs > 4000 bytes.** Read files ONLY in ≤70-line slices (`sed -n 'A,Bp' file` via Bash, or Read with `limit ≤ 70`). If any tool result contains a `[Mega Saver: compressed` footer, the output was compressed — DISTRUST it and re-run with a smaller slice. Never assume omitted content is irrelevant.
- **Never check exit codes through a pipe.** `cmd | tail` reports tail's exit code, not cmd's. Always run `cmd > /tmp/x.log 2>&1; echo RC=$?` and then slice the log.
- **`pnpm --filter <pkg> test -- <files>` does NOT scope to the given files.** To run a single test file, `cd` into the package directory and run `pnpm exec vitest run <relative-test-path>`.
- **Build dependency packages before running a dependent package's tests.** Tests import sibling packages from `dist/`. From the repo root: `pnpm -s turbo build --filter <pkg>...` — the trailing `...` includes the package's dependencies. Example: after touching `@megasaver/shared`, run `pnpm -s turbo build --filter @megasaver/context-gate...` before running context-gate tests.
- **Full gate:** `pnpm verify` from the repo root (biome + tsc project refs + vitest). Run `pnpm lint:fix` before each commit to normalize formatting.
- **Commits:** conventional commits, subject ≤ 50 chars, imperative, English. One task = one commit.

---

## Task 1: `@megasaver/shared` — stale-aware `withFileLock` (E25/E26 primitive)

The shared package currently has zero fs code (`risk-level`, `agent-id`, `ids`, `title`, `token-saver-mode`, `workspace-key`, `repository-family-key` — all pure). This adds its first fs module; keep it self-contained.

**Files:**
- Create: `packages/shared/src/file-lock.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/file-lock.test.ts`

**Steps:**

- [ ] **Write the failing test.** Create `packages/shared/test/file-lock.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFileLock } from "../src/file-lock.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-filelock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lockPath = () => join(dir, ".test.lock");
const OPTS = { deadlineMs: 10, staleMs: 5000 };

describe("withFileLock", () => {
  it("acquires, runs fn, returns true, and removes the lock file", () => {
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("returns false and does not run fn when a FRESH lock is contended", () => {
    writeFileSync(lockPath(), ""); // mtime = now → fresh holder
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(existsSync(lockPath())).toBe(true); // foreign lock untouched
  });

  it("steals a STALE lock (mtime older than staleMs) and runs fn", () => {
    writeFileSync(lockPath(), "");
    const old = new Date(Date.now() - 10_000); // 10s back > 5s staleMs
    utimesSync(lockPath(), old, old);
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("propagates fn errors AFTER releasing the lock file", () => {
    expect(() =>
      withFileLock(lockPath(), OPTS, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(lockPath())).toBe(false);
  });
});
```

- [ ] **Run to see RED.** From `packages/shared`:

```bash
cd packages/shared && pnpm exec vitest run test/file-lock.test.ts > /tmp/t1-red.log 2>&1; echo RC=$?
```

Expected: RC=1 — `Cannot find module '../src/file-lock.js'` (module does not exist).

- [ ] **Minimal implementation.** Create `packages/shared/src/file-lock.ts`:

```ts
import { closeSync, openSync, rmSync, statSync } from "node:fs";

export type FileLockOptions = { deadlineMs: number; staleMs: number };

// Cross-process advisory lock via wx-create. Best-effort by design: returns
// true when fn ran (lock acquired), false when the deadline passed while a
// FRESH lock was held (callers skip their write). A lock whose mtime is older
// than staleMs is a dead holder's residue — it is removed and the acquire
// retried, so a crashed writer can never freeze its callers forever (E25).
// fn errors propagate AFTER the lock file is released. The caller ensures the
// lock's parent directory exists.
export function withFileLock(lockPath: string, opts: FileLockOptions, fn: () => void): boolean {
  const deadline = Date.now() + opts.deadlineMs;
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      break;
    } catch {
      let stale = false;
      try {
        stale = statSync(lockPath).mtimeMs < Date.now() - opts.staleMs;
      } catch {
        // lock vanished between wx and stat — loop and retry the acquire
      }
      if (stale) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // holder released concurrently — retry the acquire either way
        }
        continue;
      }
      if (Date.now() >= deadline) return false;
    }
  }
  try {
    fn();
    return true;
  } finally {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // best-effort release; a leftover lock is stolen as stale after staleMs
    }
  }
}
```

- [ ] **Export it.** Modify `packages/shared/src/index.ts`. Current content (entire file):

```ts
export * from "./risk-level.js";
export * from "./agent-id.js";
export * from "./ids.js";
export * from "./title.js";
export * from "./token-saver-mode.js";
export * from "./workspace-key.js";
export * from "./repository-family-key.js";
```

Replace with:

```ts
export * from "./risk-level.js";
export * from "./agent-id.js";
export * from "./ids.js";
export * from "./title.js";
export * from "./token-saver-mode.js";
export * from "./workspace-key.js";
export * from "./repository-family-key.js";
export * from "./file-lock.js";
```

- [ ] **Run GREEN.**

```bash
cd packages/shared && pnpm exec vitest run test/file-lock.test.ts > /tmp/t1-green.log 2>&1; echo RC=$?
```

Expected: RC=0, 4 tests pass. Then run the whole shared suite to catch regressions:

```bash
cd packages/shared && pnpm exec vitest run > /tmp/t1-all.log 2>&1; echo RC=$?
```

- [ ] **Commit.**

```
feat(shared): add stale-aware withFileLock
```

## Task 2: context-gate heartbeat — ledger schema + record fns + E25 lock swap

Grow the heartbeat registry backward-compatibly with three parallel maps (completions / failures / daemonFallbacks), add three record functions, and replace the freeze-prone `wx` lock with Task 1's `withFileLock`. `packages/context-gate/package.json` already depends on `"@megasaver/shared": "workspace:*"` (verified) — no dependency change needed.

**Files:**
- Modify: `packages/context-gate/src/saver-heartbeat.ts` (full replacement below)
- Modify: `packages/context-gate/src/index.ts` (export block)
- Test: `packages/context-gate/test/saver-heartbeat.test.ts` (extend)

**Steps:**

- [ ] **Write the failing tests.** Append to `packages/context-gate/test/saver-heartbeat.test.ts`. First extend the imports — current top of file:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readHeartbeatView,
  recordCompressionHeartbeat,
  recordInvocationHeartbeat,
} from "../src/saver-heartbeat.js";
```

Replace with:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readHeartbeatView,
  recordCompletionHeartbeat,
  recordCompressionHeartbeat,
  recordDaemonFallbackHeartbeat,
  recordFailureHeartbeat,
  recordInvocationHeartbeat,
} from "../src/saver-heartbeat.js";
```

Then append these describe blocks at the end of the file (the file already defines `let store`, `iso`, and `NOW` at the top — reuse them):

```ts
describe("failure / completion / daemon-fallback ledger (E21)", () => {
  it("failure record increments count and keeps the newest lastAt/lastKind", () => {
    recordFailureHeartbeat(store, "aaaa", "record", iso(NOW - 1000), NOW);
    recordFailureHeartbeat(store, "aaaa", "payload", iso(NOW - 5000), NOW); // older ts still counts
    const v = readHeartbeatView(store, NOW);
    expect(v.failures?.["aaaa"]).toEqual({ count: 2, lastAt: iso(NOW - 1000), lastKind: "record" });
  });

  it("completion is strict-newer per key (older is a no-op)", () => {
    recordCompletionHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordCompletionHeartbeat(store, "aaaa", iso(NOW - 5000), NOW);
    expect(readHeartbeatView(store, NOW).completions?.["aaaa"]).toBe(iso(NOW));
  });

  it("daemon fallback counts and keeps the newest lastAt", () => {
    recordDaemonFallbackHeartbeat(store, "aaaa", iso(NOW - 2000), NOW);
    recordDaemonFallbackHeartbeat(store, "aaaa", iso(NOW - 1000), NOW);
    expect(readHeartbeatView(store, NOW).daemonFallbacks?.["aaaa"]).toEqual({
      count: 2,
      lastAt: iso(NOW - 1000),
    });
  });

  it("prunes failure entries older than 30 days", () => {
    recordFailureHeartbeat(store, "old", "unknown", iso(NOW - 31 * 86_400_000), NOW - 31 * 86_400_000);
    recordFailureHeartbeat(store, "new", "record", iso(NOW), NOW);
    const v = readHeartbeatView(store, NOW);
    expect(v.failures?.["old"]).toBeUndefined();
    expect(v.failures?.["new"]?.count).toBe(1);
  });

  it("an old-format registry (workspaces only) still reads", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(
      join(store, "stats", "saver-hook-heartbeats.json"),
      JSON.stringify({
        version: 1,
        latest: { ts: iso(NOW), workspaceKey: "aaaa" },
        latestCompression: null,
        workspaces: { aaaa: iso(NOW) },
      }),
    );
    const v = readHeartbeatView(store, NOW);
    expect(v.workspaces).toHaveProperty("aaaa", iso(NOW));
    expect(v.completions).toBeUndefined();
    expect(v.failures).toBeUndefined();
    expect(v.daemonFallbacks).toBeUndefined();
  });

  it("drops malformed failure entries field-by-field", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(
      join(store, "stats", "saver-hook-heartbeats.json"),
      JSON.stringify({
        version: 1,
        workspaces: {},
        failures: {
          good: { count: 3, lastAt: iso(NOW), lastKind: "record" },
          badKind: { count: 1, lastAt: iso(NOW), lastKind: "exploded" },
          badCount: { count: "many", lastAt: iso(NOW), lastKind: "record" },
          badShape: "nope",
        },
      }),
    );
    const v = readHeartbeatView(store, NOW);
    expect(v.failures?.["good"]?.count).toBe(3);
    expect(v.failures?.["badKind"]).toBeUndefined();
    expect(v.failures?.["badCount"]).toBeUndefined();
    expect(v.failures?.["badShape"]).toBeUndefined();
  });
});

describe("stale lock (E25)", () => {
  it("steals a stale lock file instead of skipping forever", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    const lock = join(store, "stats", ".saver-heartbeat.lock");
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 10_000);
    utimesSync(lock, old, old);
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    expect(readHeartbeatView(store, NOW).workspaces).toHaveProperty("aaaa", iso(NOW));
  });

  it("a fresh contended lock still skips (contention semantics kept)", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(join(store, "stats", ".saver-heartbeat.lock"), ""); // mtime = now
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    expect(readHeartbeatView(store, NOW).workspaces).not.toHaveProperty("aaaa");
  });
});
```

- [ ] **Run to see RED.** First build shared (Task 1 output) into dist, then run:

```bash
pnpm -s turbo build --filter @megasaver/context-gate... > /tmp/t2-build.log 2>&1; echo RC=$?
cd packages/context-gate && pnpm exec vitest run test/saver-heartbeat.test.ts > /tmp/t2-red.log 2>&1; echo RC=$?
```

Expected: RC=1 — the E21 tests fail to compile (`recordFailureHeartbeat` etc. are not exported), and the stale-lock test fails against the current lock (the 10 ms `wx` loop gives up and the workspace never appears).

- [ ] **Minimal implementation — replace the ENTIRE file** `packages/context-gate/src/saver-heartbeat.ts` (182 lines today; the invocation/compression/persist logic below is byte-compatible with the current behavior) with:

```ts
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
```

- [ ] **Update the index exports.** In `packages/context-gate/src/index.ts`, the current block:

```ts
export {
  type HeartbeatView,
  type HeartbeatStamp,
  readHeartbeatView,
  recordInvocationHeartbeat,
  recordCompressionHeartbeat,
} from "./saver-heartbeat.js";
```

Replace with:

```ts
export {
  type HeartbeatView,
  type HeartbeatStamp,
  type FailureKind,
  type HeartbeatFailureEntry,
  type HeartbeatFallbackEntry,
  readHeartbeatView,
  recordInvocationHeartbeat,
  recordCompressionHeartbeat,
  recordCompletionHeartbeat,
  recordFailureHeartbeat,
  recordDaemonFallbackHeartbeat,
} from "./saver-heartbeat.js";
```

- [ ] **Run GREEN.**

```bash
cd packages/context-gate && pnpm exec vitest run test/saver-heartbeat.test.ts > /tmp/t2-green.log 2>&1; echo RC=$?
```

Expected: RC=0 — all pre-existing tests (strict-newer, TTL, cap, 0600 mode, corrupt-registry) plus the 8 new ones pass. The pre-existing `missing registry reads as empty` test stays green because empty grown maps are omitted from the view. Then run the whole package suite:

```bash
cd packages/context-gate && pnpm exec vitest run > /tmp/t2-all.log 2>&1; echo RC=$?
```

- [ ] **Commit.**

```
feat(context-gate): failure ledger in heartbeat
```

## Task 3: stats — self-healing overlay summaries (E24)

A corrupt per-session summary currently throws `StatsError("store_corrupt")` and freezes that session's stats while orphan events accumulate. Rebuild it from the corruption-tolerant JSONL reader instead. Note: overlay events carry neither `secretsRedacted` nor `chunksStored`, so a rebuild folds those two counters as 0 — the repair deliberately trades them for liveness.

**Files:**
- Modify: `packages/stats/src/summary.ts` (schema gains `rebuiltAt`)
- Modify: `packages/stats/src/store.ts` (strict loader rename + rebuild + self-heal paths)
- Modify: `packages/stats/src/index.ts` (export)
- Test: `packages/stats/test/overlay-selfheal.test.ts` (new)

**Steps:**

- [ ] **Write the failing test.** Create `packages/stats/test/overlay-selfheal.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  appendOverlayEvent,
  readOverlaySummary,
  rebuildOverlaySummaryFromEvents,
} from "../src/store.js";

const WK = "wk-selfheal";
const ID = "live-selfheal-1";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-stats-heal-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function event(id: string, rawBytes: number): OverlayTokenSaverEvent {
  return {
    id,
    liveSessionId: ID,
    workspaceKey: WK,
    createdAt: "2026-07-10T00:00:00.000Z",
    sourceKind: "command",
    label: "echo",
    rawBytes,
    returnedBytes: 100,
    bytesSaved: rawBytes - 100,
    savingRatio: (rawBytes - 100) / rawBytes,
    summary: "s",
    mode: "balanced",
  };
}

function corruptSummary(): string {
  const p = join(root, "stats", WK, `${ID}.json`);
  mkdirSync(join(root, "stats", WK), { recursive: true });
  writeFileSync(p, "{{{ not json");
  return p;
}

describe("E24 self-healing overlay summaries", () => {
  it("readOverlaySummary rebuilds a corrupt summary from the events JSONL", () => {
    appendOverlayEvent({ store: { root }, event: event("e1", 1000), secretsRedacted: 1, chunksStored: 1 });
    appendOverlayEvent({ store: { root }, event: event("e2", 2000), secretsRedacted: 0, chunksStored: 1 });
    corruptSummary();
    const s = readOverlaySummary({ root }, WK, ID);
    expect(s?.eventsTotal).toBe(2);
    expect(s?.rawBytesTotal).toBe(3000);
    expect(s?.bytesSavedTotal).toBe(2800);
    expect(s?.rebuiltAt).toBeDefined();
    // the repair trades the two event-less counters for liveness:
    expect(s?.secretsRedactedTotal).toBe(0);
    expect(s?.chunksStoredTotal).toBe(0);
  });

  it("appendOverlayEvent survives a corrupt summary and counts prior events + the new one", () => {
    appendOverlayEvent({ store: { root }, event: event("e1", 1000), secretsRedacted: 0, chunksStored: 1 });
    corruptSummary();
    const next = appendOverlayEvent({ store: { root }, event: event("e2", 2000), secretsRedacted: 0, chunksStored: 1 });
    expect(next.eventsTotal).toBe(2);
    expect(next.rawBytesTotal).toBe(3000);
    expect(next.rebuiltAt).toBeDefined();
  });

  it("corrupt summary + missing events file rebuilds to an EMPTY summary instead of throwing", () => {
    corruptSummary(); // no .events.jsonl exists next to it
    const s = readOverlaySummary({ root }, WK, ID);
    expect(s?.eventsTotal).toBe(0);
    expect(s?.rawBytesTotal).toBe(0);
    expect(s?.rebuiltAt).toBeDefined();
  });

  it("rebuildOverlaySummaryFromEvents persists the rebuilt summary", () => {
    appendOverlayEvent({ store: { root }, event: event("e1", 1000), secretsRedacted: 0, chunksStored: 1 });
    corruptSummary();
    const rebuilt = rebuildOverlaySummaryFromEvents({ root }, WK, ID, "2026-07-10T12:00:00.000Z");
    expect(rebuilt.rebuiltAt).toBe("2026-07-10T12:00:00.000Z");
    expect(rebuilt.updatedAt).toBe("2026-07-10T12:00:00.000Z");
    const onDisk = JSON.parse(readFileSync(join(root, "stats", WK, `${ID}.json`), "utf8"));
    expect(onDisk.eventsTotal).toBe(1);
    expect(onDisk.rebuiltAt).toBe("2026-07-10T12:00:00.000Z");
  });
});
```

- [ ] **Run to see RED.**

```bash
pnpm -s turbo build --filter @megasaver/stats... > /tmp/t3-build.log 2>&1; echo RC=$?
cd packages/stats && pnpm exec vitest run test/overlay-selfheal.test.ts > /tmp/t3-red.log 2>&1; echo RC=$?
```

Expected: RC=1 — `rebuildOverlaySummaryFromEvents` is not exported (compile error), and today `readOverlaySummary` / `appendOverlayEvent` over a corrupt summary throw `StatsError: store_corrupt`.

- [ ] **Minimal implementation.** Three edits.

**(a)** `packages/stats/src/summary.ts` — the overlay schema. Current:

```ts
export const overlaySessionTokenSaverStatsSchema = z
  .object({
    liveSessionId: z.string().min(1),
    eventsTotal: z.number().int().nonnegative(),
    rawBytesTotal: z.number().int().nonnegative(),
    returnedBytesTotal: z.number().int().nonnegative(),
    bytesSavedTotal: z.number().int().nonnegative(),
    savingRatio: z.number().min(0).max(1),
    secretsRedactedTotal: z.number().int().nonnegative(),
    chunksStoredTotal: z.number().int().nonnegative(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
```

Replace with:

```ts
export const overlaySessionTokenSaverStatsSchema = z
  .object({
    liveSessionId: z.string().min(1),
    eventsTotal: z.number().int().nonnegative(),
    rawBytesTotal: z.number().int().nonnegative(),
    returnedBytesTotal: z.number().int().nonnegative(),
    bytesSavedTotal: z.number().int().nonnegative(),
    savingRatio: z.number().min(0).max(1),
    secretsRedactedTotal: z.number().int().nonnegative(),
    chunksStoredTotal: z.number().int().nonnegative(),
    updatedAt: z.string().datetime({ offset: true }),
    // E24: present iff the summary was reconstructed from its events JSONL.
    rebuiltAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
```

**(b)** `packages/stats/src/store.ts` — rename the strict loader and add the heal paths. Current (lines ~174-190):

```ts
function loadOverlaySummary(path: string): OverlaySessionTokenSaverStats | null {
  if (!existsSync(path)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new StatsError("store_corrupt");
  }
  const parsed = overlaySessionTokenSaverStatsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StatsError("store_corrupt");
  }
  return parsed.data;
}
```

Replace with (same body, new name, plus three new functions after it):

```ts
function loadOverlaySummaryStrict(path: string): OverlaySessionTokenSaverStats | null {
  if (!existsSync(path)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new StatsError("store_corrupt");
  }
  const parsed = overlaySessionTokenSaverStatsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StatsError("store_corrupt");
  }
  return parsed.data;
}

// E24 self-heal: rebuild the summary from the corruption-tolerant JSONL reader
// and persist it. secretsRedactedTotal / chunksStoredTotal cannot be recovered
// from events — events carry neither — so the repair trades those two counters
// for liveness (rebuilt as 0). A missing events file rebuilds to an empty
// summary (readOverlayEvents returns []), never a throw.
export function rebuildOverlaySummaryFromEvents(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
  nowIso: string = new Date().toISOString(),
): OverlaySessionTokenSaverStats {
  const events = readOverlayEvents(store, workspaceKey, liveSessionId);
  let eventsTotal = 0;
  let rawBytesTotal = 0;
  let returnedBytesTotal = 0;
  let bytesSavedTotal = 0;
  for (const event of events) {
    eventsTotal += 1;
    rawBytesTotal += event.rawBytes;
    returnedBytesTotal += event.returnedBytes;
    bytesSavedTotal += event.bytesSaved;
  }
  const rebuilt: OverlaySessionTokenSaverStats = {
    liveSessionId,
    eventsTotal,
    rawBytesTotal,
    returnedBytesTotal,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: nowIso,
    rebuiltAt: nowIso,
  };
  atomicWriteFile(
    overlaySummaryPath(store, workspaceKey, liveSessionId),
    JSON.stringify(rebuilt),
  );
  return rebuilt;
}

// If the REBUILD itself fails, keep the original store_corrupt posture.
function rebuildGuarded(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats {
  try {
    return rebuildOverlaySummaryFromEvents(store, workspaceKey, liveSessionId);
  } catch {
    throw new StatsError("store_corrupt");
  }
}

// Self-healing read: repair-on-read is by design, so this WRITES on a corrupt
// summary (atomicWriteFile). Non-corrupt errors still propagate.
function loadOverlaySummarySelfHealing(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats | null {
  try {
    return loadOverlaySummaryStrict(overlaySummaryPath(store, workspaceKey, liveSessionId));
  } catch (error) {
    if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
    return rebuildGuarded(store, workspaceKey, liveSessionId);
  }
}
```

Note: `readOverlayEvents` is defined LOWER in the same file (~line 421) — function declarations hoist, so calling it here is fine.

**(c)** Still in `store.ts` — rewire the two consumers. Current `appendOverlayEvent` (lines ~206-237):

```ts
export function appendOverlayEvent(input: AppendOverlayEventInput): OverlaySessionTokenSaverStats {
  const { store, secretsRedacted, chunksStored } = input;
  const parsed = overlayTokenSaverEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;

  const events = overlayEventsPath(store, event.workspaceKey, event.liveSessionId);
  const summary = overlaySummaryPath(store, event.workspaceKey, event.liveSessionId);

  mkdirSync(dirname(events), { recursive: true });
  appendFileSync(events, `${JSON.stringify(event)}\n`);

  const prior = loadOverlaySummary(summary) ?? emptyOverlaySummary(event.liveSessionId);
  const rawBytesTotal = prior.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = prior.bytesSavedTotal + event.bytesSaved;
  const next: OverlaySessionTokenSaverStats = {
    liveSessionId: event.liveSessionId,
    eventsTotal: prior.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: prior.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: prior.secretsRedactedTotal + secretsRedacted,
    chunksStoredTotal: prior.chunksStoredTotal + chunksStored,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteFile(summary, JSON.stringify(next));
  return next;
}

export function readOverlaySummary(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats | null {
  return loadOverlaySummary(overlaySummaryPath(store, workspaceKey, liveSessionId));
}
```

Replace with:

```ts
export function appendOverlayEvent(input: AppendOverlayEventInput): OverlaySessionTokenSaverStats {
  const { store, secretsRedacted, chunksStored } = input;
  const parsed = overlayTokenSaverEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;

  const events = overlayEventsPath(store, event.workspaceKey, event.liveSessionId);
  const summary = overlaySummaryPath(store, event.workspaceKey, event.liveSessionId);

  mkdirSync(dirname(events), { recursive: true });
  appendFileSync(events, `${JSON.stringify(event)}\n`);

  let prior: OverlaySessionTokenSaverStats | null;
  try {
    prior = loadOverlaySummaryStrict(summary);
  } catch (error) {
    if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
    // E24: corrupt summary — the JSONL (which already contains the line
    // appended above) is authoritative. The rebuild therefore covers this
    // event too; do NOT accumulate on top of it.
    return rebuildGuarded(store, event.workspaceKey, event.liveSessionId);
  }
  const base = prior ?? emptyOverlaySummary(event.liveSessionId);
  const rawBytesTotal = base.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = base.bytesSavedTotal + event.bytesSaved;
  const next: OverlaySessionTokenSaverStats = {
    liveSessionId: event.liveSessionId,
    eventsTotal: base.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: base.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: base.secretsRedactedTotal + secretsRedacted,
    chunksStoredTotal: base.chunksStoredTotal + chunksStored,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteFile(summary, JSON.stringify(next));
  return next;
}

export function readOverlaySummary(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats | null {
  return loadOverlaySummarySelfHealing(store, workspaceKey, liveSessionId);
}
```

`readOverlaySummaryAnyWorkspace` stays untouched — its per-workspace `try { … } catch { continue; }` now rarely fires (the self-heal path absorbs corruption) but keeps guarding non-corrupt errors.

- [ ] **Export.** In `packages/stats/src/index.ts`, the store export block currently contains (excerpt):

```ts
  appendOverlayEvent,
  type AppendOverlayEventInput,
  readOverlayEvents,
  readOverlaySummary,
  readOverlaySummaryAnyWorkspace,
```

Replace with:

```ts
  appendOverlayEvent,
  type AppendOverlayEventInput,
  readOverlayEvents,
  readOverlaySummary,
  readOverlaySummaryAnyWorkspace,
  rebuildOverlaySummaryFromEvents,
```

- [ ] **Run GREEN.**

```bash
cd packages/stats && pnpm exec vitest run test/overlay-selfheal.test.ts > /tmp/t3-green.log 2>&1; echo RC=$?
cd packages/stats && pnpm exec vitest run > /tmp/t3-all.log 2>&1; echo RC=$?
```

Expected: RC=0 both. If any pre-existing test in `overlay-store.test.ts`/`store.test.ts` asserted that a corrupt summary THROWS `store_corrupt` on read/append, re-baseline it to the new self-heal semantics (assert the rebuilt summary + `rebuiltAt` instead) — the spec explicitly lists these files as expected re-baselines.

- [ ] **Commit.**

```
feat(stats): self-heal corrupt overlay summaries
```

---

## Task 4: stats summary lock (E26) + GC drift reconciliation

Serialize the summary read-modify-write under a stale-aware lock; on contention skip the summary write (the JSONL line is already durable) and let a new `reconcileOverlaySummaries` — invoked from the daily GC sweep — repair the count permanently. `packages/stats/package.json` already depends on `"@megasaver/shared": "workspace:*"` (verified). The CLI must NOT import `@megasaver/stats` directly (§3c allow-list, enforced by `apps/cli/test/dependency-graph.test.ts`) — so `reconcileOverlaySummaries` is re-exported through `@megasaver/core`.

**Files:**
- Modify: `packages/stats/src/store.ts` (lock in `appendOverlayEvent`, new `reconcileOverlaySummaries`)
- Modify: `packages/stats/src/index.ts` (export)
- Modify: `packages/core/src/context-gate.ts` (re-export for the CLI)
- Modify: `apps/cli/src/hooks/gc.ts` (call reconcile in the sweep)
- Test: `packages/stats/test/overlay-lock.test.ts` (new), `apps/cli/test/hooks/gc.test.ts` (extend)

**Steps:**

- [ ] **Write the failing tests.** Create `packages/stats/test/overlay-lock.test.ts`:

```ts
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import { appendOverlayEvent, readOverlayEvents, reconcileOverlaySummaries } from "../src/store.js";

const WK = "wk-lock";
const ID = "live-lock-1";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-stats-lock-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function event(id: string): OverlayTokenSaverEvent {
  return {
    id,
    liveSessionId: ID,
    workspaceKey: WK,
    createdAt: "2026-07-10T00:00:00.000Z",
    sourceKind: "command",
    label: "echo",
    rawBytes: 1000,
    returnedBytes: 100,
    bytesSaved: 900,
    savingRatio: 0.9,
    summary: "s",
    mode: "balanced",
  };
}

const summaryPath = () => join(root, "stats", WK, `${ID}.json`);
const eventsPath = () => join(root, "stats", WK, `${ID}.events.jsonl`);

describe("E26 summary lock + reconciliation", () => {
  it("a contended fresh lock skips the summary write but keeps the JSONL line", () => {
    appendOverlayEvent({ store: { root }, event: event("e1"), secretsRedacted: 0, chunksStored: 1 });
    writeFileSync(`${summaryPath()}.lock`, ""); // fresh foreign lock (mtime = now)
    const returned = appendOverlayEvent({ store: { root }, event: event("e2"), secretsRedacted: 0, chunksStored: 1 });
    // stale summary returned (only e1 counted) — but the JSONL grew to 2 lines
    expect(returned.eventsTotal).toBe(1);
    expect(readOverlayEvents({ root }, WK, ID)).toHaveLength(2);
    expect(JSON.parse(readFileSync(summaryPath(), "utf8")).eventsTotal).toBe(1);
  });

  it("reconcileOverlaySummaries rebuilds summaries whose count lags their JSONL (two-writer lost update)", () => {
    appendOverlayEvent({ store: { root }, event: event("e1"), secretsRedacted: 0, chunksStored: 1 });
    // simulate the lost update: writer B's line landed but its summary write lost
    appendFileSync(eventsPath(), `${JSON.stringify(event("e2"))}\n`);
    expect(JSON.parse(readFileSync(summaryPath(), "utf8")).eventsTotal).toBe(1);
    const rebuilt = reconcileOverlaySummaries({ root });
    expect(rebuilt).toBe(1);
    const after = JSON.parse(readFileSync(summaryPath(), "utf8"));
    expect(after.eventsTotal).toBe(2);
    expect(after.bytesSavedTotal).toBe(1800);
  });

  it("reconcile repairs a corrupt summary and leaves healthy ones alone", () => {
    appendOverlayEvent({ store: { root }, event: event("e1"), secretsRedacted: 0, chunksStored: 1 });
    expect(reconcileOverlaySummaries({ root })).toBe(0); // healthy → untouched
    writeFileSync(summaryPath(), "{{{ corrupt");
    expect(reconcileOverlaySummaries({ root })).toBe(1);
    expect(JSON.parse(readFileSync(summaryPath(), "utf8")).eventsTotal).toBe(1);
  });
});
```

And append to `apps/cli/test/hooks/gc.test.ts` (inside the existing `describe("maybeRunOverlayGc", …)` block; the file already imports `existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync`, `encodeWorkspaceKey`, `vi`, and defines `store`/`NOW` — add `readFileSync` and `join` is already imported):

```ts
  it("reconciles overlay summaries whose count lags the JSONL (E26 drift)", async () => {
    const wk = encodeWorkspaceKey("/test/proj");
    const id = "live-gc-drift-1";
    const dir = join(store, "stats", wk);
    mkdirSync(dir, { recursive: true });
    const ev = (n: number) =>
      JSON.stringify({
        id: `e${n}`,
        liveSessionId: id,
        workspaceKey: wk,
        createdAt: "2026-07-10T00:00:00.000Z",
        sourceKind: "command",
        label: "echo",
        rawBytes: 1000,
        returnedBytes: 100,
        bytesSaved: 900,
        savingRatio: 0.9,
        summary: "s",
        mode: "balanced",
      });
    writeFileSync(join(dir, `${id}.events.jsonl`), `${ev(1)}\n${ev(2)}\n${ev(3)}\n`);
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        liveSessionId: id,
        eventsTotal: 1,
        rawBytesTotal: 1000,
        returnedBytesTotal: 100,
        bytesSavedTotal: 900,
        savingRatio: 0.9,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 0,
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    );
    const prune = vi.fn(async () => ({ removed: 0 }));
    const ran = await maybeRunOverlayGc(store, { now: () => NOW, prune });
    expect(ran).toBe(true);
    const after = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    expect(after.eventsTotal).toBe(3);
    expect(after.rebuiltAt).toBeDefined();
  });
```

- [ ] **Run to see RED.**

```bash
cd packages/stats && pnpm exec vitest run test/overlay-lock.test.ts > /tmp/t4-red1.log 2>&1; echo RC=$?
```

Expected: RC=1 — `reconcileOverlaySummaries` is not exported (compile error); the contended-lock test would also fail because today's append ignores the lock and writes `eventsTotal: 2`.

```bash
pnpm -s turbo build --filter @megasaver/cli... > /tmp/t4-build.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/hooks/gc.test.ts > /tmp/t4-red2.log 2>&1; echo RC=$?
```

Expected: RC=1 — after GC the summary still reads `eventsTotal: 1`.

- [ ] **Minimal implementation.** Four edits.

**(a)** `packages/stats/src/store.ts` — add the import at the top of the file. Current first import lines:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
```

Replace with:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ProjectId, type SessionId, withFileLock } from "@megasaver/shared";
```

**(b)** `packages/stats/src/store.ts` — wrap the summary read-modify-write of `appendOverlayEvent` (the Task 3 version) in the lock. Current (Task 3 result, from `let prior` to the final `return next;`):

```ts
  let prior: OverlaySessionTokenSaverStats | null;
  try {
    prior = loadOverlaySummaryStrict(summary);
  } catch (error) {
    if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
    // E24: corrupt summary — the JSONL (which already contains the line
    // appended above) is authoritative. The rebuild therefore covers this
    // event too; do NOT accumulate on top of it.
    return rebuildGuarded(store, event.workspaceKey, event.liveSessionId);
  }
  const base = prior ?? emptyOverlaySummary(event.liveSessionId);
  const rawBytesTotal = base.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = base.bytesSavedTotal + event.bytesSaved;
  const next: OverlaySessionTokenSaverStats = {
    liveSessionId: event.liveSessionId,
    eventsTotal: base.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: base.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: base.secretsRedactedTotal + secretsRedacted,
    chunksStoredTotal: base.chunksStoredTotal + chunksStored,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteFile(summary, JSON.stringify(next));
  return next;
}
```

Replace with:

```ts
  // E26: parallel tool calls in one turn race this read-modify-write.
  // Serialize under a short stale-aware lock: deadlineMs 50 (a hook must not
  // stall the agent), staleMs 5000 (a dead writer's lock is stolen).
  let next: OverlaySessionTokenSaverStats | null = null;
  const ran = withFileLock(`${summary}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
    let prior: OverlaySessionTokenSaverStats | null;
    try {
      prior = loadOverlaySummaryStrict(summary);
    } catch (error) {
      if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
      // E24: corrupt summary — the JSONL (which already contains the line
      // appended above) is authoritative. The rebuild therefore covers this
      // event too; do NOT accumulate on top of it.
      next = rebuildGuarded(store, event.workspaceKey, event.liveSessionId);
      return;
    }
    const base = prior ?? emptyOverlaySummary(event.liveSessionId);
    const rawBytesTotal = base.rawBytesTotal + event.rawBytes;
    const bytesSavedTotal = base.bytesSavedTotal + event.bytesSaved;
    next = {
      liveSessionId: event.liveSessionId,
      eventsTotal: base.eventsTotal + 1,
      rawBytesTotal,
      returnedBytesTotal: base.returnedBytesTotal + event.returnedBytes,
      bytesSavedTotal,
      savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
      secretsRedactedTotal: base.secretsRedactedTotal + secretsRedacted,
      chunksStoredTotal: base.chunksStoredTotal + chunksStored,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteFile(summary, JSON.stringify(next));
  });
  if (ran && next !== null) return next;
  // Lock contended: the event line is already durable in the JSONL. Skip the
  // summary update and return the freshest readable summary; the GC sweep's
  // reconcileOverlaySummaries repairs the undercount permanently.
  return (
    loadOverlaySummarySelfHealing(store, event.workspaceKey, event.liveSessionId) ??
    emptyOverlaySummary(event.liveSessionId)
  );
}
```

**(c)** `packages/stats/src/store.ts` — add `reconcileOverlaySummaries` directly below `rebuildOverlaySummaryFromEvents`:

```ts
// E26 repair: summaries that lag their JSONL (lock-skipped updates) or fail
// schema are rebuilt. Bounded: invoked from the once-a-day GC sweep. Returns
// the number of files rebuilt. Best-effort — every per-file failure is
// swallowed so one bad workspace cannot stop the walk.
// ponytail: line count counts ALL non-empty lines while the rebuild folds only
// schema-valid ones, so a JSONL with garbage lines is re-rebuilt every sweep —
// benign (once/day, atomic write); tighten to a validated count if it matters.
export function reconcileOverlaySummaries(store: StatsStore): number {
  let rebuilt = 0;
  let workspaces: string[];
  try {
    workspaces = readdirSync(join(store.root, "stats"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return 0;
  }
  for (const workspaceKey of workspaces) {
    if (!isSafeSegment(workspaceKey)) continue;
    let files: string[];
    try {
      files = readdirSync(join(store.root, "stats", workspaceKey));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".events.jsonl")) continue;
      const liveSessionId = file.slice(0, -".events.jsonl".length);
      if (!isSafeSegment(liveSessionId)) continue;
      try {
        const lineCount = readFileSync(join(store.root, "stats", workspaceKey, file), "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "").length;
        let summary: OverlaySessionTokenSaverStats | null = null;
        let corrupt = false;
        try {
          summary = loadOverlaySummaryStrict(
            overlaySummaryPath(store, workspaceKey, liveSessionId),
          );
        } catch {
          corrupt = true;
        }
        if (corrupt || summary === null || summary.eventsTotal < lineCount) {
          rebuildOverlaySummaryFromEvents(store, workspaceKey, liveSessionId);
          rebuilt += 1;
        }
      } catch {
        /* best-effort: continue the walk */
      }
    }
  }
  return rebuilt;
}
```

Add `reconcileOverlaySummaries,` to the same `packages/stats/src/index.ts` store export block right after the `rebuildOverlaySummaryFromEvents,` line added in Task 3.

**(d)** `packages/core/src/context-gate.ts` — the CLI reads stats through core (§3c). Current re-export block (third stats block in that file):

```ts
export {
  aggregateHonestMetrics,
  observationsFromEvents,
  readOverlayEvents,
  readOverlaySummaryAnyWorkspace,
  recordedEventsFromLogs,
  tokensFromBytes,
  proxyUsageSavings,
  sumBytesSavedSince,
  type HonestMetrics,
  type OverlaySessionTokenSaverStats,
  type OverlayTokenSaverEvent,
  type ProxyUsageSavings,
  type ProxyUsageTokenCounts,
} from "@megasaver/stats";
```

Replace with:

```ts
export {
  aggregateHonestMetrics,
  observationsFromEvents,
  readOverlayEvents,
  readOverlaySummaryAnyWorkspace,
  reconcileOverlaySummaries,
  recordedEventsFromLogs,
  tokensFromBytes,
  proxyUsageSavings,
  sumBytesSavedSince,
  type HonestMetrics,
  type OverlaySessionTokenSaverStats,
  type OverlayTokenSaverEvent,
  type ProxyUsageSavings,
  type ProxyUsageTokenCounts,
} from "@megasaver/stats";
```

**(e)** `apps/cli/src/hooks/gc.ts`. Current imports:

```ts
import { readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pruneOlderThan } from "@megasaver/content-store";
```

Replace with:

```ts
import { readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pruneOlderThan } from "@megasaver/content-store";
import { reconcileOverlaySummaries } from "@megasaver/core";
```

Current final block of `maybeRunOverlayGc`:

```ts
  try {
    await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
    pruneIntentFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
    return true;
  } catch {
    return false;
  }
}
```

Replace with:

```ts
  try {
    await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
    pruneIntentFiles(storeRoot, now() - OVERLAY_RETENTION_MS);
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
```

- [ ] **Run GREEN.**

```bash
cd packages/stats && pnpm exec vitest run test/overlay-lock.test.ts test/overlay-selfheal.test.ts > /tmp/t4-green1.log 2>&1; echo RC=$?
pnpm -s turbo build --filter @megasaver/cli... > /tmp/t4-build2.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/hooks/gc.test.ts > /tmp/t4-green2.log 2>&1; echo RC=$?
```

Expected: RC=0 for all three.

- [ ] **Commit.**

```
feat(stats): lock summary writes, reconcile drift
```

## Task 5: CLI saver wiring (E21) + resolve surfaces

`buildSaverDecision`'s catch fires with zero telemetry; `makeRecord`'s daemon fallback is silent. Wire both to the Task 2 ledger, and surface the ledger in `mega session saver resolve`.

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (SaverDeps + buildSaverDecision restructure)
- Modify: `apps/cli/src/hooks/saver-run.ts` (default deps + makeRecord fallback)
- Modify: `apps/cli/src/commands/session/saver/resolve.ts` (2 text lines + 3 JSON fields)
- Test: `apps/cli/test/hooks/saver.test.ts`, `apps/cli/test/hooks/saver-run.test.ts`, `apps/cli/test/session-saver-resolve.test.ts` (extend all three)

**Steps:**

- [ ] **Write the failing tests.**

**(a)** `apps/cli/test/hooks/saver.test.ts` — the file's `deps()` helper must first grow the two new fields (otherwise every existing test in the 900-line file fails type-check once `SaverDeps` grows). Current helper:

```ts
function deps(overrides: Partial<Parameters<typeof buildSaverDecision>[1]> = {}) {
  return {
    storeRoot: "/store",
    resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
    readSessionIntent: () => undefined,
    record: vi.fn().mockResolvedValue(RECORDED),
    recordInvocation: vi.fn(),
    recordCompression: vi.fn(),
    ...overrides,
  };
}
```

Replace with:

```ts
function deps(overrides: Partial<Parameters<typeof buildSaverDecision>[1]> = {}) {
  return {
    storeRoot: "/store",
    resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
    readSessionIntent: () => undefined,
    record: vi.fn().mockResolvedValue(RECORDED),
    recordInvocation: vi.fn(),
    recordCompression: vi.fn(),
    recordFailure: vi.fn(),
    recordCompletion: vi.fn(),
    ...overrides,
  };
}
```

Then append at the end of the file (reuses the existing `bigBash` helper and `encodeWorkspaceKey` import):

```ts
describe("E21 failure + completion ledger", () => {
  it("records a completion after a successful run", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.recordCompletion).toHaveBeenCalledOnce();
    const [storeRoot, wk, ts] = d.recordCompletion.mock.calls[0] as [string, string, string];
    expect(storeRoot).toBe("/store");
    expect(wk).toBe(encodeWorkspaceKey("/Users/x/proj"));
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
    expect(d.recordFailure).not.toHaveBeenCalled();
  });

  it('a throwing record dep stays passthrough AND records a failure with kind "record"', async () => {
    const d = deps({ record: vi.fn().mockRejectedValue(new Error("disk full")) });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect(out).toEqual({ passthrough: true });
    expect(d.recordFailure).toHaveBeenCalledOnce();
    const [, wk, kind] = d.recordFailure.mock.calls[0] as [string, string, string, string];
    expect(wk).toBe(encodeWorkspaceKey("/Users/x/proj"));
    expect(kind).toBe("record");
    expect(d.recordCompletion).not.toHaveBeenCalled();
  });

  it('a payload that explodes during parsing records kind "payload" with a cwd-derived key', async () => {
    const d = deps();
    const bomb = {
      get tool_name(): string {
        throw new Error("boom");
      },
    };
    const out = await buildSaverDecision(bomb, d);
    expect(out).toEqual({ passthrough: true });
    expect(d.recordFailure).toHaveBeenCalledOnce();
    const [, wk, kind] = d.recordFailure.mock.calls[0] as [string, string, string, string];
    expect(kind).toBe("payload");
    expect(wk).toBe(encodeWorkspaceKey(process.cwd()));
  });

  it("a throwing ledger write never breaks the decision", async () => {
    const d = deps({
      recordCompletion: vi.fn(() => {
        throw new Error("ledger io");
      }),
    });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
  });
});
```

**(b)** `apps/cli/test/hooks/saver-run.test.ts` — append inside the existing `describe("makeRecord", …)` block (the file already has `startStub`, `tempStore`, `baseInput`, `chunkDir`, `WS_KEY`, `DAEMON_CHUNK_SET_ID`, `servers`; add `readHeartbeatView` to the `@megasaver/context-gate` imports — the file currently has no context-gate import, so add `import { readHeartbeatView } from "@megasaver/context-gate";` below the `@megasaver/daemon` imports):

```ts
  it("records a daemon fallback when the POST fails and falls back in-process (E21)", async () => {
    const clientStore = tempStore();
    const stub = await startStub({
      storeRoot: clientStore,
      excerptResponse: { status: 500, body: { error: "boom" } },
    });
    servers.push(stub);

    const record = makeRecord(clientStore);
    const result = await record(baseInput(clientStore));

    // fell back in-process: local chunks written, daemon sentinel absent
    expect(result.decision).toBe("compressed");
    expect(result.chunkSetId).not.toBe(DAEMON_CHUNK_SET_ID);
    expect(existsSync(chunkDir(clientStore))).toBe(true);

    const hb = readHeartbeatView(clientStore);
    expect(hb.daemonFallbacks?.[WS_KEY]?.count).toBe(1);
  });

  it("does NOT count a fallback when no daemon is advertised", async () => {
    const store = tempStore();
    const record = makeRecord(store);
    const result = await record(baseInput(store));
    expect(result.decision).toBe("compressed");
    expect(readHeartbeatView(store).daemonFallbacks).toBeUndefined();
  });
```

**(c)** `apps/cli/test/session-saver-resolve.test.ts` — extend the import (current: `recordInvocationHeartbeat, writeExactRecord, writeGlobalDefault` from `@megasaver/context-gate`) to also import `recordDaemonFallbackHeartbeat, recordFailureHeartbeat`, then append inside the existing describe (the file already defines `store`, `CWD`, and the `run(json, now?)` helper):

```ts
  it("renders failure and daemon-fallback telemetry for this workspace", async () => {
    const now = Date.UTC(2026, 0, 1);
    const wk = encodeWorkspaceKey(CWD);
    recordFailureHeartbeat(store, wk, "record", new Date(now).toISOString(), now);
    recordDaemonFallbackHeartbeat(store, wk, new Date(now).toISOString(), now);
    const { out } = await run(false, now);
    const joined = out.join("\n");
    expect(joined).toContain(
      `hook failures (this workspace): 1 (last ${new Date(now).toISOString()}, record)`,
    );
    expect(joined).toContain(
      `daemon fallbacks (this workspace): 1 (last ${new Date(now).toISOString()})`,
    );
  });

  it("emits the new ledger fields in JSON", async () => {
    const now = Date.UTC(2026, 0, 1);
    const wk = encodeWorkspaceKey(CWD);
    recordFailureHeartbeat(store, wk, "payload", new Date(now).toISOString(), now);
    const { out } = await run(true, now);
    const p = JSON.parse(out[0] as string);
    expect(p.failures).toEqual({
      count: 1,
      lastAt: new Date(now).toISOString(),
      lastKind: "payload",
    });
    expect(p.completions).toBeNull();
    expect(p.daemonFallbacks).toBeNull();
  });

  it("shows none observed when the ledger is empty", async () => {
    const { out } = await run(false);
    const joined = out.join("\n");
    expect(joined).toContain("hook failures (this workspace): none observed");
    expect(joined).toContain("daemon fallbacks (this workspace): none observed");
  });
```

- [ ] **Run to see RED.**

```bash
pnpm -s turbo build --filter @megasaver/cli... > /tmp/t5-build.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/hooks/saver.test.ts test/hooks/saver-run.test.ts test/session-saver-resolve.test.ts > /tmp/t5-red.log 2>&1; echo RC=$?
```

Expected: RC=1 — `recordFailure`/`recordCompletion` are not in `SaverDeps` (excess-property + call assertions fail), `daemonFallbacks` never recorded, resolve renders no ledger lines.

- [ ] **Minimal implementation.**

**(a)** `apps/cli/src/hooks/saver.ts`. Current first import line:

```ts
import { OVERLAY_CHUNK_LINES } from "@megasaver/context-gate";
```

Replace with:

```ts
import { type FailureKind, OVERLAY_CHUNK_LINES } from "@megasaver/context-gate";
```

Current `SaverDeps` (lines ~65-79):

```ts
export type SaverDeps = {
  storeRoot: string;
  // Resolves activation from the cwd through the repository-family precedence
  // (exact → family → legacy-root → global). null ⇒ disabled/passthrough.
  resolveSettings: (storeRoot: string, cwd: string) => SaverSettings | null;
  readSessionIntent: (
    storeRoot: string,
    workspaceKey: string,
    sessionId?: string,
  ) => string | undefined;
  record: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
  // Metadata-only liveness heartbeats (best-effort; never block the tool call).
  recordInvocation: (storeRoot: string, workspaceKey: string) => void;
  recordCompression: (storeRoot: string, workspaceKey: string) => void;
};
```

Replace with:

```ts
export type SaverDeps = {
  storeRoot: string;
  // Resolves activation from the cwd through the repository-family precedence
  // (exact → family → legacy-root → global). null ⇒ disabled/passthrough.
  resolveSettings: (storeRoot: string, cwd: string) => SaverSettings | null;
  readSessionIntent: (
    storeRoot: string,
    workspaceKey: string,
    sessionId?: string,
  ) => string | undefined;
  record: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
  // Metadata-only liveness heartbeats (best-effort; never block the tool call).
  recordInvocation: (storeRoot: string, workspaceKey: string) => void;
  recordCompression: (storeRoot: string, workspaceKey: string) => void;
  // E21 ledger (best-effort; never block the tool call).
  recordFailure: (storeRoot: string, workspaceKey: string, kind: FailureKind, tsIso: string) => void;
  recordCompletion: (storeRoot: string, workspaceKey: string, tsIso: string) => void;
};
```

**(b)** Restructure `buildSaverDecision` (currently lines ~224-320). Today it is ONE exported async function: the header comment `// Pure decision: never throws (callers rely on this), returns passthrough on any / // gate miss.`, then `export async function buildSaverDecision(payload: unknown, deps: SaverDeps): Promise<SaverDecision> {`, then a single `try {` holding the entire 90-line body (field extraction → `resolveSourceKind` → C13 Bash guard → `encodeWorkspaceKey` → `recordInvocation` → settings/intent/shape/floor gates → `await deps.record({...})` → `recordCompression` → footer build → final return), closed by `} catch { return PASSTHROUGH; // §13.4 best-effort: never break the tool call. }`. That try-body moves verbatim into a private `decide()` with exactly three inserted context lines; the exported wrapper owns the ledger. Replace the whole current function with:

```ts
type DecisionContext = { stage: FailureKind; workspaceKey?: string };

// Pure decision: never throws (callers rely on this), returns passthrough on
// any gate miss. `deps` are injected so tests need no fs/store. E21: a throw
// records a failure heartbeat with a coarse stage, a finished run records a
// completion — the invocation/completion gap is the crash signal. The §13.4
// fail-open posture is unchanged; failures become visible, not fatal.
export async function buildSaverDecision(
  payload: unknown,
  deps: SaverDeps,
): Promise<SaverDecision> {
  const ctx: DecisionContext = { stage: "payload" };
  try {
    const decision = await decide(payload, deps, ctx);
    try {
      deps.recordCompletion(
        deps.storeRoot,
        ctx.workspaceKey ?? encodeWorkspaceKey(process.cwd()),
        new Date().toISOString(),
      );
    } catch {
      /* ledger is best-effort */
    }
    return decision;
  } catch {
    try {
      deps.recordFailure(
        deps.storeRoot,
        // On a payload-stage failure the payload's cwd never parsed; fall back
        // to the hook process's own cwd — the same key the settings path uses.
        ctx.workspaceKey ?? encodeWorkspaceKey(process.cwd()),
        ctx.stage,
        new Date().toISOString(),
      );
    } catch {
      /* ledger is best-effort */
    }
    return PASSTHROUGH; // §13.4 best-effort: never break the tool call.
  }
}

async function decide(
  payload: unknown,
  deps: SaverDeps,
  ctx: DecisionContext,
): Promise<SaverDecision> {
  if (typeof payload !== "object" || payload === null) return PASSTHROUGH;
  const p = payload as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const tool = asStr(p["tool_name"]);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const sessionId = asStr(p["session_id"]);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const cwd = asStr(p["cwd"]);
  if (tool === undefined || sessionId === undefined || cwd === undefined) return PASSTHROUGH;
  ctx.stage = "resolve";

  const sourceKind = resolveSourceKind(tool);
  if (sourceKind === undefined) return PASSTHROUGH;

  // C13: a recovery expansion must arrive whole — never re-compress it.
  // Foreground Bash only (the footer advertises a foreground run); a
  // backgrounded expansion read via BashOutput has no command in its input
  // to match — its re-compression is itself recoverable, so it's tolerated.
  if (tool === "Bash") {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const ti = p["tool_input"];
    const i = typeof ti === "object" && ti !== null ? (ti as Record<string, unknown>) : {};
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const cmd = asStr(i["command"]) ?? "";
    if (/\bmega\s+output\s+chunk\b/.test(cmd)) return PASSTHROUGH;
  }

  const workspaceKey = encodeWorkspaceKey(cwd);
  ctx.workspaceKey = workspaceKey;
  // Step 1: liveness heartbeat for every valid payload, before activation and
  // size gates (so a healthy hook is observable even on passthrough).
  deps.recordInvocation(deps.storeRoot, workspaceKey);

  const settings = deps.resolveSettings(deps.storeRoot, cwd);
  if (settings === null || !settings.enabled) return PASSTHROUGH;
  const sessionIntent = deps.readSessionIntent(deps.storeRoot, workspaceKey, sessionId);

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const shape = readOutputShape(p["tool_response"]);
  if (shape === null) return PASSTHROUGH;
  const floorBytes = minBytesFor(tool, settings.mode);
  if (Buffer.byteLength(shape.raw, "utf8") <= floorBytes) return PASSTHROUGH;

  ctx.stage = "record";
  const recorded = await deps.record({
    storeRoot: deps.storeRoot,
    // Evidence rows live under <storeRoot>/evidence/<wk>/ — same base root the
    // MCP approve-memory path reads from. Passing it turns on the best-effort
    // evidence write inside record(); a failure there never blocks compression.
    evidenceStoreRoot: deps.storeRoot,
    workspaceKey,
    liveSessionId: sessionId,
    raw: shape.raw,
    sourceKind,
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    label: labelOf(p["tool_input"], tool),
    mode: settings.mode,
    storeRawOutput: true,
    // B8: the gate above is the single eligibility authority; record()
    // collapses the filter thresholds onto it.
    compressFloorBytes: floorBytes,
    ...(sessionIntent !== undefined ? { intent: sessionIntent } : {}),
  });
  if (recorded.decision !== "compressed") return PASSTHROUGH;

  // Step 5: a qualifying compression updates the global latestCompression.
  deps.recordCompression(deps.storeRoot, workspaceKey);

  const rawTokens = tokensFromBytes(recorded.rawBytes);
  const returnedTokens = tokensFromBytes(recorded.returnedBytes);
  const tokenPct = rawTokens === 0 ? "0.0" : ((1 - returnedTokens / rawTokens) * 100).toFixed(1);
  const n = recorded.chunkCount ?? 1;
  const L = OVERLAY_CHUNK_LINES;
  // Advertise chunk IDS, never a line->id formula: chunks index the REDACTED
  // stored text, while the agent sees the original tool output's line numbers
  // (a multi-line secret redacts to one line, shifting the two spaces apart).
  // Fetch by id 0..n-1 is correct regardless.
  const expandCmd =
    n > 1
      ? `— stored in ${n} chunks of ~${L} lines each; fetch any with: mega output chunk "${recorded.chunkSetId}" "<i>" (i = 0..${n - 1})`
      : `— run: mega output chunk "${recorded.chunkSetId}" "0"`;
  const partialNoun = n > 1 ? "recovered chunks are" : "recovered chunk is";
  const recovery = looksPreTruncated(shape.raw)
    ? `NOTE: upstream output appears truncated, ${partialNoun} PARTIAL, not complete ${expandCmd} (or MCP proxy_expand_chunk if connected)`
    : `Full output recoverable ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
  const pointer = recorded.chunkSetId
    ? `\n\n[Mega Saver: compressed ${recorded.rawBytes}→${recorded.returnedBytes} B (~${rawTokens}→${returnedTokens} tokens, ${tokenPct}%). ${recovery}.]`
    : "";
  return { updatedToolOutput: shape.rebuild(`${recorded.returnedText}${pointer}`) };
}
```

(The `decide()` body is the current try-body verbatim with exactly three inserted lines: `ctx.stage = "resolve";` after the field-extraction guard, `ctx.workspaceKey = workspaceKey;` after `encodeWorkspaceKey(cwd)`, and `ctx.stage = "record";` immediately before `await deps.record({`. Note: the wrapper records a completion for EVERY non-throwing finish — passthrough decisions included; a passthrough is a successful run, and completion measures "finished", not "compressed".)

**(c)** `apps/cli/src/hooks/saver-run.ts`. Current context-gate import:

```ts
import {
  nodeResolverDeps,
  recordCompressionHeartbeat,
  recordInvocationHeartbeat,
  resolveWorkspaceTokenSaverSettings,
} from "@megasaver/context-gate";
```

Replace with:

```ts
import {
  type FailureKind,
  nodeResolverDeps,
  recordCompletionHeartbeat,
  recordCompressionHeartbeat,
  recordDaemonFallbackHeartbeat,
  recordFailureHeartbeat,
  recordInvocationHeartbeat,
  resolveWorkspaceTokenSaverSettings,
} from "@megasaver/context-gate";
```

Current heartbeat wrappers:

```ts
// Best-effort metadata-only heartbeats; a failure never blocks the tool call.
function recordInvocation(storeRoot: string, workspaceKey: string): void {
  try {
    recordInvocationHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
function recordCompression(storeRoot: string, workspaceKey: string): void {
  try {
    recordCompressionHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
```

Replace with:

```ts
// Best-effort metadata-only heartbeats; a failure never blocks the tool call.
function recordInvocation(storeRoot: string, workspaceKey: string): void {
  try {
    recordInvocationHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
function recordCompression(storeRoot: string, workspaceKey: string): void {
  try {
    recordCompressionHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
function recordFailure(
  storeRoot: string,
  workspaceKey: string,
  kind: FailureKind,
  tsIso: string,
): void {
  try {
    recordFailureHeartbeat(storeRoot, workspaceKey, kind, tsIso);
  } catch {
    /* liveness is best-effort */
  }
}
function recordCompletion(storeRoot: string, workspaceKey: string, tsIso: string): void {
  try {
    recordCompletionHeartbeat(storeRoot, workspaceKey, tsIso);
  } catch {
    /* liveness is best-effort */
  }
}
function recordDaemonFallback(storeRoot: string, workspaceKey: string): void {
  try {
    recordDaemonFallbackHeartbeat(storeRoot, workspaceKey, new Date().toISOString());
  } catch {
    /* liveness is best-effort */
  }
}
```

Current `makeRecord`:

```ts
/** Try to forward to the running daemon's /excerpt; fall back to in-process on any failure.
 *  Exported for tests. Never throws — every failure mode returns in-process result. */
export function makeRecord(storeRoot: string): SaverDeps["record"] {
  return async (input: RecordOverlayOutputInput): Promise<RecordOverlayOutputResult> => {
    try {
      const handle = await getRunningDaemon({ storeRoot });
      if (handle !== null) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS);
        try {
          const {
            storeRoot: _sr,
            evidenceStoreRoot: _esr,
            now: _now,
            newId: _nid,
            ...daemonBody
          } = input;
          // ponytail: daemon excerptHandler supplies storeRoot itself; do NOT add evidenceStoreRoot
          const res = await handle.request("POST", "/excerpt", daemonBody, controller.signal);
          clearTimeout(timer);
          if (res.ok) {
            return (await res.json()) as RecordOverlayOutputResult;
          }
        } catch {
          clearTimeout(timer);
        }
      }
    } catch {
      // fall through to in-process
    }
    return recordAndFilterOverlayOutput(input);
  };
}
```

Replace with:

```ts
/** Try to forward to the running daemon's /excerpt; fall back to in-process on any failure.
 *  Exported for tests. Never throws — every failure mode returns in-process result.
 *  E21: a daemon that EXISTED but whose POST failed/timed out counts one
 *  daemonFallbacks bump (behavior unchanged; the silent fallback becomes countable). */
export function makeRecord(storeRoot: string): SaverDeps["record"] {
  return async (input: RecordOverlayOutputInput): Promise<RecordOverlayOutputResult> => {
    let daemonFailed = false;
    try {
      const handle = await getRunningDaemon({ storeRoot });
      if (handle !== null) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS);
        try {
          const {
            storeRoot: _sr,
            evidenceStoreRoot: _esr,
            now: _now,
            newId: _nid,
            ...daemonBody
          } = input;
          // ponytail: daemon excerptHandler supplies storeRoot itself; do NOT add evidenceStoreRoot
          const res = await handle.request("POST", "/excerpt", daemonBody, controller.signal);
          clearTimeout(timer);
          if (res.ok) {
            return (await res.json()) as RecordOverlayOutputResult;
          }
          daemonFailed = true;
        } catch {
          clearTimeout(timer);
          daemonFailed = true;
        }
      }
    } catch {
      // fall through to in-process
    }
    if (daemonFailed) recordDaemonFallback(storeRoot, input.workspaceKey);
    return recordAndFilterOverlayOutput(input);
  };
}
```

And the deps object inside `runSaverHookFromProcess` — current:

```ts
    const deps: SaverDeps = {
      storeRoot,
      resolveSettings,
      readSessionIntent,
      record: makeRecord(storeRoot),
      recordInvocation,
      recordCompression,
    };
```

Replace with:

```ts
    const deps: SaverDeps = {
      storeRoot,
      resolveSettings,
      readSessionIntent,
      record: makeRecord(storeRoot),
      recordInvocation,
      recordCompression,
      recordFailure,
      recordCompletion,
    };
```

**(d)** `apps/cli/src/commands/session/saver/resolve.ts`. Current JSON block tail:

```ts
        lastInvocationAt: lastInvocation?.ts ?? null,
        lastInvocationHereAt: invokedHere,
        lastCompressionAt: lastCompression?.ts ?? null,
      }),
    );
    return 0;
  }
```

Replace with:

```ts
        lastInvocationAt: lastInvocation?.ts ?? null,
        lastInvocationHereAt: invokedHere,
        lastCompressionAt: lastCompression?.ts ?? null,
        completions: hb.completions?.[requested] ?? null,
        failures: hb.failures?.[requested] ?? null,
        daemonFallbacks: hb.daemonFallbacks?.[requested] ?? null,
      }),
    );
    return 0;
  }
```

Current text-render tail:

```ts
  input.stdout(`  last compression (global): ${lastCompression?.ts ?? "none observed"}`);
  return 0;
}
```

Replace with:

```ts
  input.stdout(`  last compression (global): ${lastCompression?.ts ?? "none observed"}`);
  const fail = hb.failures?.[requested];
  input.stdout(
    fail !== undefined
      ? `  hook failures (this workspace): ${fail.count} (last ${fail.lastAt}, ${fail.lastKind})`
      : "  hook failures (this workspace): none observed",
  );
  const fallback = hb.daemonFallbacks?.[requested];
  input.stdout(
    fallback !== undefined
      ? `  daemon fallbacks (this workspace): ${fallback.count} (last ${fallback.lastAt})`
      : "  daemon fallbacks (this workspace): none observed",
  );
  return 0;
}
```

- [ ] **Run GREEN.**

```bash
pnpm -s turbo build --filter @megasaver/cli... > /tmp/t5-build2.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/hooks/saver.test.ts test/hooks/saver-run.test.ts test/session-saver-resolve.test.ts > /tmp/t5-green.log 2>&1; echo RC=$?
```

Expected: RC=0. Also run `cd apps/cli && pnpm exec vitest run test/hooks/saver-roundtrip.test.ts` — the roundtrip drives `runSaverHookFromProcess` and must stay green with the new default deps.

- [ ] **Commit.**

```
feat(cli): saver failure + completion telemetry
```

## Task 6: connector install hardening (E23 + E29)

Hook commands become absolute-path + timeout + optional `--store` bake; matching moves from exact command equality to a `hooks <subcommand>` suffix so re-install migrates legacy bare entries and uninstall removes every form. All existing exports/constants stay.

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `packages/connectors/claude-code/src/index.ts`
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Test: `packages/connectors/claude-code/test/hook-settings.test.ts`, `apps/cli/test/hooks/install.test.ts` (extend both; re-baseline noted below)

**Steps:**

- [ ] **Write the failing tests.**

**(a)** Append to `packages/connectors/claude-code/test/hook-settings.test.ts` (the file already has `tmpSettings(initial?)`, `readFileSync`, and imports `HOOK_MATCHER`, `SAVER_HOOK_MATCHER`, `DEFAULT_HOOK_COMMAND`, `installClaudeCodeHook`, `uninstallClaudeCodeHook`; add `buildHookCommand, hookCommandMatches` to the import list from `../src/hook-settings.js`):

```ts
describe("buildHookCommand (E23/E29)", () => {
  it("legacy bare form when no config", () => {
    expect(buildHookCommand("saver")).toBe("mega hooks saver");
    expect(buildHookCommand("log")).toBe(DEFAULT_HOOK_COMMAND);
    expect(buildHookCommand("intent")).toBe("mega hooks intent");
  });

  it("absolute cliPath, quoted only when it contains whitespace", () => {
    expect(buildHookCommand("saver", { cliPath: "/opt/homebrew/bin/mega" })).toBe(
      "/opt/homebrew/bin/mega hooks saver",
    );
    expect(buildHookCommand("saver", { cliPath: "/Users/a b/mega" })).toBe(
      '"/Users/a b/mega" hooks saver',
    );
  });

  it("bakes --store between the binary and the subcommand", () => {
    expect(
      buildHookCommand("saver", { cliPath: "/usr/local/bin/mega", storeRoot: "/data/mega" }),
    ).toBe('/usr/local/bin/mega --store "/data/mega" hooks saver');
  });
});

describe("hookCommandMatches", () => {
  it("matches bare, absolute, and store-baked forms", () => {
    expect(hookCommandMatches("mega hooks saver", "saver")).toBe(true);
    expect(hookCommandMatches("/opt/homebrew/bin/mega hooks saver", "saver")).toBe(true);
    expect(hookCommandMatches('"/Users/a b/mega" --store "/data" hooks saver', "saver")).toBe(true);
  });

  it("does not cross subcommands or match unrelated commands", () => {
    expect(hookCommandMatches("mega hooks saver", "log")).toBe(false);
    expect(hookCommandMatches("myhooks saver", "saver")).toBe(false);
    expect(hookCommandMatches("other-tool", "saver")).toBe(false);
  });
});

describe("install migration (E23/E29)", () => {
  it("fresh install with config writes absolute commands + timeouts", () => {
    const p = tmpSettings();
    const r = installClaudeCodeHook({
      settingsPath: p,
      config: { cliPath: "/opt/homebrew/bin/mega" },
    });
    expect(r.changed).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.hooks.PostToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "/opt/homebrew/bin/mega hooks saver",
      timeout: 30,
    });
    expect(s.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "/opt/homebrew/bin/mega hooks log",
      timeout: 10,
    });
    expect(s.hooks.UserPromptSubmit[0].hooks[0]).toEqual({
      type: "command",
      command: "/opt/homebrew/bin/mega hooks intent",
      timeout: 10,
    });
  });

  it("re-install over legacy bare entries migrates them in place (no duplicates)", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [{ matcher: HOOK_MATCHER, hooks: [{ type: "command", command: "mega hooks log" }] }],
        PostToolUse: [
          { matcher: SAVER_HOOK_MATCHER, hooks: [{ type: "command", command: "mega hooks saver" }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "mega hooks intent" }] }],
      },
    });
    const r = installClaudeCodeHook({
      settingsPath: p,
      config: { cliPath: "/opt/homebrew/bin/mega" },
    });
    expect(r.changed).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.hooks.PostToolUse).toHaveLength(1);
    expect(s.hooks.PostToolUse[0].hooks[0].command).toBe("/opt/homebrew/bin/mega hooks saver");
    expect(s.hooks.PostToolUse[0].hooks[0].timeout).toBe(30);
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("uninstall removes store-baked absolute forms too", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: HOOK_MATCHER,
            hooks: [{ type: "command", command: "/opt/homebrew/bin/mega hooks log", timeout: 10 }],
          },
        ],
        PostToolUse: [
          {
            matcher: SAVER_HOOK_MATCHER,
            hooks: [
              {
                type: "command",
                command: '/opt/homebrew/bin/mega --store "/data" hooks saver',
                timeout: 30,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "/opt/homebrew/bin/mega hooks intent", timeout: 10 }] },
        ],
      },
    });
    const r = uninstallClaudeCodeHook({ settingsPath: p });
    expect(r.changed).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.hooks).toBeUndefined();
  });
});
```

**(b)** Append to `apps/cli/test/hooks/install.test.ts` (add `mkdtempSync, rmSync` usage — the file already imports `mkdtempSync, readFileSync, rmSync, writeFileSync`, `tmpdir`, `join`; add the new import line):

```ts
import {
  resolveBakedStoreRoot,
  resolveInvokedCliPath,
  runHooksInstall,
} from "../../src/commands/hooks/install.js";
```

then:

```ts
describe("E29 store baking", () => {
  const env = {
    cwd: "/work",
    home: "/home/u",
    xdgDataHome: undefined,
    platform: "linux" as NodeJS.Platform,
    localAppData: undefined,
  };

  it("a non-default store resolves to a baked root", () => {
    expect(resolveBakedStoreRoot({ ...env, storeFlag: "/custom/store" })).toBe("/custom/store");
  });

  it("the default store bakes nothing", () => {
    expect(resolveBakedStoreRoot({ ...env, storeFlag: undefined })).toBeUndefined();
  });

  it("runHooksInstall writes the config-built commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-install-bake-"));
    try {
      const p = join(dir, "settings.json");
      const code = runHooksInstall({
        target: "claude-code",
        settingsPath: p,
        config: { cliPath: "/opt/homebrew/bin/mega", storeRoot: "/custom/store" },
        stdout: () => {},
        stderr: () => {},
        json: false,
      });
      expect(code).toBe(0);
      const s = JSON.parse(readFileSync(p, "utf8"));
      expect(s.hooks.PostToolUse[0].hooks[0].command).toBe(
        '/opt/homebrew/bin/mega --store "/custom/store" hooks saver',
      );
      expect(s.hooks.PostToolUse[0].hooks[0].timeout).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveInvokedCliPath", () => {
  it("returns an absolute argv[1] as-is", () => {
    expect(resolveInvokedCliPath("/usr/local/bin/mega")).toBe("/usr/local/bin/mega");
  });

  it("returns undefined when argv[1] is missing or unresolvable", () => {
    expect(resolveInvokedCliPath(undefined)).toBeUndefined();
    expect(resolveInvokedCliPath("definitely-not-a-real-file-xyz")).toBeUndefined();
  });
});
```

- [ ] **Run to see RED.**

```bash
cd packages/connectors/claude-code && pnpm exec vitest run test/hook-settings.test.ts > /tmp/t6-red1.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/hooks/install.test.ts > /tmp/t6-red2.log 2>&1; echo RC=$?
```

Expected: RC=1 in both — `buildHookCommand`/`hookCommandMatches`/`resolveBakedStoreRoot`/`resolveInvokedCliPath` do not exist; `installClaudeCodeHook` has no `config` input.

- [ ] **Minimal implementation.**

**(a)** `packages/connectors/claude-code/src/hook-settings.ts`. Six regions change.

Region 1 — after the constants (`INTENT_HOOK_COMMAND` line), the current type + matcher helpers:

```ts
type CommandHook = { type: "command"; command: string };
```

and

```ts
function entryReferencesCommand(entry: unknown, command: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as ToolUseEntry).hooks;
  return Array.isArray(hooks) && hooks.some((h) => h?.command === command);
}

// Rewrites the matcher on the entry (if any) that already references
// `command`, leaving every other entry untouched and never mutating the
// input array or its entries. Returns null when no entry references the
// command, so the caller falls through to appending a new one.
function repairMatcher(
  entries: ToolUseEntry[],
  command: string,
  matcher: string,
): ToolUseEntry[] | null {
  let found = false;
  const next = entries.map((entry) => {
    if (!entryReferencesCommand(entry, command)) return entry;
    found = true;
    return entry.matcher === matcher ? entry : { ...entry, matcher };
  });
  return found ? next : null;
}
```

Replace the `CommandHook` line with:

```ts
type CommandHook = { type: "command"; command: string; timeout?: number };

export type HookCommandConfig = { cliPath?: string; storeRoot?: string };

// E23: hook commands are built from the stable ABSOLUTE launcher path of the
// running CLI (quoted iff it contains whitespace — the hook shell splits on
// spaces) plus, for a non-default store, an E29 `--store` bake. cliPath absent
// keeps the legacy bare "mega" form.
export function buildHookCommand(
  subcommand: "log" | "saver" | "intent",
  cfg: HookCommandConfig = {},
): string {
  const bin = cfg.cliPath === undefined ? "mega" : quoteIfNeeded(cfg.cliPath);
  const store = cfg.storeRoot === undefined ? "" : ` --store "${cfg.storeRoot}"`;
  return `${bin}${store} hooks ${subcommand}`;
}

function quoteIfNeeded(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

// One matcher for every historical command form: bare `mega hooks saver`,
// absolute `/abs/mega hooks saver`, store-baked `/abs/mega --store "…" hooks
// saver`. The space-prefixed suffix check excludes accidental substrings
// ("myhooks saver").
export function hookCommandMatches(command: string, subcommand: string): boolean {
  return command === `hooks ${subcommand}` || command.endsWith(` hooks ${subcommand}`);
}

// Every Mega hook command ends with "hooks <subcommand>"; the public add/has/
// remove functions keep their (settings, command) signatures for compat and
// derive the subcommand from the command's last token.
function subcommandOf(command: string): string {
  const parts = command.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function timeoutFor(subcommand: string): number {
  return subcommand === "saver" ? 30 : 10;
}
```

and replace `entryReferencesCommand` + `repairMatcher` with:

```ts
function entryMatchesSubcommand(entry: unknown, subcommand: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as ToolUseEntry).hooks;
  return (
    Array.isArray(hooks) &&
    hooks.some((h) => typeof h?.command === "string" && hookCommandMatches(h.command, subcommand))
  );
}

// Rewrites, on every entry that already carries this subcommand, the matcher
// (when given) AND the CommandHook itself to `desired` — this is how a legacy
// bare/absolute/store-baked entry migrates in place on re-install. Never
// mutates the input array or its entries. Returns null when no entry matched,
// so the caller falls through to appending a new one.
function repairEntry(
  entries: ToolUseEntry[],
  subcommand: string,
  matcher: string | undefined,
  desired: CommandHook,
): ToolUseEntry[] | null {
  let found = false;
  const next = entries.map((entry) => {
    if (!entryMatchesSubcommand(entry, subcommand)) return entry;
    found = true;
    const hooks = (entry.hooks ?? []).map((h) =>
      typeof h?.command === "string" && hookCommandMatches(h.command, subcommand)
        ? { ...desired }
        : h,
    );
    const repaired: ToolUseEntry = { ...entry, hooks };
    if (matcher !== undefined) repaired.matcher = matcher;
    return repaired;
  });
  return found ? next : null;
}
```

Region 2 — `hasPreToolUseHook` / `addPreToolUseHook`. Current:

```ts
export function hasPreToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryReferencesCommand(e, command));
}

export function addPreToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairMatcher(existingPre as ToolUseEntry[], command, HOOK_MATCHER);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: HOOK_MATCHER, hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}
```

Replace with:

```ts
export function hasPreToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addPreToolUseHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(existingPre as ToolUseEntry[], sub, HOOK_MATCHER, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}
```

Region 3 — `hasPostToolUseHook` / `addPostToolUseHook`. Current:

```ts
export function hasPostToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const post = (settings as SettingsObject).hooks?.PostToolUse;
  return Array.isArray(post) && post.some((e) => entryReferencesCommand(e, command));
}

export function addPostToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existingPost = next.hooks?.PostToolUse;
  if (Array.isArray(existingPost)) {
    const repaired = repairMatcher(existingPost as ToolUseEntry[], command, SAVER_HOOK_MATCHER);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PostToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const post = Array.isArray(existingPost) ? [...(existingPost as ToolUseEntry[])] : [];
  post.push({ matcher: SAVER_HOOK_MATCHER, hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, PostToolUse: post };
  return next;
}
```

Replace with:

```ts
export function hasPostToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const post = (settings as SettingsObject).hooks?.PostToolUse;
  return Array.isArray(post) && post.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addPostToolUseHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPost = next.hooks?.PostToolUse;
  if (Array.isArray(existingPost)) {
    const repaired = repairEntry(existingPost as ToolUseEntry[], sub, SAVER_HOOK_MATCHER, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PostToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const post = Array.isArray(existingPost) ? [...(existingPost as ToolUseEntry[])] : [];
  post.push({ matcher: SAVER_HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PostToolUse: post };
  return next;
}
```

Region 4 — `stripCommand`. Current filter line inside it:

```ts
    const hooks = entry.hooks.filter((h) => h?.command !== command);
```

Rename the function's second parameter from `command: string` to `subcommand: string` and change the filter to:

```ts
    const hooks = entry.hooks.filter(
      (h) => !(typeof h?.command === "string" && hookCommandMatches(h.command, subcommand)),
    );
```

Then in `removePreToolUseHook`, `removePostToolUseHook`, `removeUserPromptSubmitHook`, change each `stripCommand(existing as ToolUseEntry[], command)` call to `stripCommand(existing as ToolUseEntry[], subcommandOf(command))`.

Region 5 — `hasUserPromptSubmitHook` / `addUserPromptSubmitHook`. Current:

```ts
export function hasUserPromptSubmitHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const ups = (settings as SettingsObject).hooks?.UserPromptSubmit;
  return Array.isArray(ups) && ups.some((e) => entryReferencesCommand(e, command));
}

export function addUserPromptSubmitHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  if (hasUserPromptSubmitHook(next, command)) return next;
  const hooks = next.hooks ? { ...next.hooks } : {};
  const existingUps = hooks.UserPromptSubmit;
  const ups = Array.isArray(existingUps) ? [...(existingUps as ToolUseEntry[])] : [];
  // ponytail: no matcher for UserPromptSubmit — Claude Code ignores the field for this event type
  ups.push({ hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, UserPromptSubmit: ups };
  return next;
}
```

Replace with:

```ts
export function hasUserPromptSubmitHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const ups = (settings as SettingsObject).hooks?.UserPromptSubmit;
  return Array.isArray(ups) && ups.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addUserPromptSubmitHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingUps = next.hooks?.UserPromptSubmit;
  if (Array.isArray(existingUps)) {
    const repaired = repairEntry(existingUps as ToolUseEntry[], sub, undefined, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, UserPromptSubmit: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const ups = Array.isArray(existingUps) ? [...(existingUps as ToolUseEntry[])] : [];
  // ponytail: no matcher for UserPromptSubmit — Claude Code ignores the field for this event type
  ups.push({ hooks: [desired] });
  next.hooks = { ...hooks, UserPromptSubmit: ups };
  return next;
}
```

Region 6 — `installClaudeCodeHook` and its input type. Current:

```ts
export type InstallClaudeCodeHookInput = { settingsPath: string; command?: string };
```

Replace with:

```ts
export type InstallClaudeCodeHookInput = {
  settingsPath: string;
  command?: string;
  config?: HookCommandConfig;
};
```

Current install function head:

```ts
export function installClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  const existing = readSettings(input.settingsPath);
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, SAVER_HOOK_COMMAND);
  next = addUserPromptSubmitHook(next, INTENT_HOOK_COMMAND);
```

Replace with:

```ts
export function installClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const cfg = input.config ?? {};
  const command = input.command ?? buildHookCommand("log", cfg);
  const existing = readSettings(input.settingsPath);
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, buildHookCommand("saver", cfg));
  next = addUserPromptSubmitHook(next, buildHookCommand("intent", cfg));
```

(the diff-by-value tail of the function is unchanged). `uninstallClaudeCodeHook` and `readClaudeCodeHookStatus` need NO body change — their `has*`/`remove*` calls now match by suffix, which is exactly the E23 requirement (`buildHookCommand("log")` with no config equals `DEFAULT_HOOK_COMMAND`, so their defaults still resolve subcommand "log"/"saver"/"intent").

**(b)** `packages/connectors/claude-code/src/index.ts` — the hook-settings export block. Add three lines. Current block start:

```ts
export {
  HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
```

Replace with:

```ts
export {
  HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  buildHookCommand,
  hookCommandMatches,
  type HookCommandConfig,
```

**(c)** `apps/cli/src/commands/hooks/install.ts` — full replacement (current file is 66 lines; the new one adds path/store resolution):

```ts
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  type ClaudeCodeHookResult,
  type HookCommandConfig,
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../store.js";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

export type RunHooksInstallInput = {
  target: string;
  settingsPath: string;
  command?: string;
  config?: HookCommandConfig;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

// E23: register the stable launcher path (argv[1]), not the versioned realpath
// target — the launcher symlink survives upgrades. Fall back to the bare form
// when the invoked path cannot be resolved (tests, REPL).
export function resolveInvokedCliPath(
  argv1: string | undefined = process.argv[1],
): string | undefined {
  if (argv1 === undefined || argv1 === "") return undefined;
  if (isAbsolute(argv1)) return argv1;
  try {
    return realpathSync(argv1);
  } catch {
    return undefined;
  }
}

// E29: bake --store into the hook commands ONLY when the CLI's resolved store
// differs from what the same environment resolves without the flag (the
// default). Equal roots bake nothing, keeping default installs byte-stable.
export function resolveBakedStoreRoot(env: ResolveStorePathInput): string | undefined {
  try {
    const resolved = resolveStorePath(env);
    const dflt = resolveStorePath({ ...env, storeFlag: undefined });
    return resolved === dflt ? undefined : resolved;
  } catch {
    return undefined;
  }
}

export function runHooksInstall(input: RunHooksInstallInput): 0 | 1 {
  if (input.target !== "claude-code") {
    input.stderr(`error: unknown hook target "${input.target}" (supported: claude-code)`);
    return 1;
  }
  let result: ClaudeCodeHookResult;
  try {
    result = installClaudeCodeHook({
      settingsPath: input.settingsPath,
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
    });
  } catch (err) {
    input.stderr(
      `error: could not install Claude Code hook at ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  if (input.json) {
    input.stdout(JSON.stringify({ target: input.target, ...result }));
  } else {
    input.stdout(
      result.changed
        ? `Installed Claude Code Mega Saver hooks (PreToolUse telemetry + PostToolUse saver + UserPromptSubmit intent) at ${result.settingsPath}`
        : `Claude Code Mega Saver hooks already installed at ${result.settingsPath} (no-op)`,
    );
  }
  return 0;
}

export const hooksInstallCommand = defineCommand({
  meta: {
    name: "install",
    description: "Install the Claude Code Mega Saver hooks (telemetry + saver).",
  },
  args: {
    target: { type: "positional", required: true, description: "Hook target (claude-code)." },
    settings: { type: "string", description: "Override Claude Code settings.json path." },
    store: {
      type: "string",
      description: "Override store directory (baked into the hook commands when non-default).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  run({ args }) {
    const cliPath = resolveInvokedCliPath();
    const storeRoot = resolveBakedStoreRoot(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const config: HookCommandConfig = {
      ...(cliPath !== undefined ? { cliPath } : {}),
      ...(storeRoot !== undefined ? { storeRoot } : {}),
    };
    const code = runHooksInstall({
      target: typeof args.target === "string" ? args.target : "",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      config,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Re-baseline existing assertions (mechanical rule).** Every existing assertion of the exact shape `toEqual({ type: "command", command: <cmd> })` in `packages/connectors/claude-code/test/hook-settings.test.ts` and `apps/cli/test/hooks/install.test.ts` gains a `timeout` field: `timeout: 10` when `<cmd>` ends in `hooks log` / `hooks intent`, `timeout: 30` when it ends in `hooks saver`. Known instances (find the rest with `grep -n 'type: "command", command' <file>`):
  - `apps/cli/test/hooks/install.test.ts` "uses the five-tool matcher…": `expect(entry?.hooks[0]).toEqual({ type: "command", command: COMMAND });` → `expect(entry?.hooks[0]).toEqual({ type: "command", command: COMMAND, timeout: 10 });`
  - `apps/cli/test/hooks/install.test.ts` "adds a PostToolUse matcher…": `expect(entry?.hooks[0]).toEqual({ type: "command", command: SAVER_HOOK_COMMAND });` → same object plus `timeout: 30`.
  Do the equivalent in `hook-settings.test.ts`. Assertions that only check `hooks[0].command` or use `hasPreToolUseHook`/`toHaveLength` need no change. If `apps/cli/test/hooks/uninstall.test.ts` or `apps/cli/test/connector-doctor.test.ts` fail after this task, apply the same rule there.

- [ ] **Run GREEN.**

```bash
pnpm -s turbo build --filter @megasaver/connector-claude-code... > /tmp/t6-build.log 2>&1; echo RC=$?
cd packages/connectors/claude-code && pnpm exec vitest run > /tmp/t6-green1.log 2>&1; echo RC=$?
pnpm -s turbo build --filter @megasaver/cli... > /tmp/t6-build2.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/hooks/install.test.ts test/hooks/uninstall.test.ts > /tmp/t6-green2.log 2>&1; echo RC=$?
```

Expected: RC=0 for both test runs (entire connector suite, plus the two CLI hook suites).

- [ ] **Commit.**

```
feat(connector): absolute hook commands + timeout
```

## Task 7: doctor becomes a saver verifier (E22 + E29 mismatch)

New `runSaverChecks` in its own file (keeps `doctor.ts` small), appended to the doctor report. Semantics: WARN = `pass: true` with a `reason` prefixed `warn:` (the existing `Check` shape has no third state and warnings must not fail the exit code); FAIL = `pass: false` → exit 1 via the existing `exitCodeFor`. The binary check carries an E22.2 version sub-check: the registered binary's `--version` (via the same spawn dep) is compared against the running CLI's version (main.ts pattern: `__MEGA_CLI_VERSION__` define with a `createRequire` package.json fallback) — WARN on mismatch, never FAIL; skipped for bare `mega` commands, when the CLI version is unresolvable, or when the probe yields no output. When no saver command is registered, the binary/version/store-bake/self-test checks are skipped entirely (registration already FAILs).

**Files:**
- Create: `apps/cli/src/commands/doctor-saver.ts`
- Modify: `apps/cli/src/commands/doctor.ts`
- Test: `apps/cli/test/doctor-saver.test.ts` (new), `apps/cli/test/doctor.test.ts` (re-baseline 2 assertions)

**Steps:**

- [ ] **Write the failing test.** Create `apps/cli/test/doctor-saver.test.ts` (all deps injected; NO real spawning anywhere):

```ts
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFailureHeartbeat, recordInvocationHeartbeat } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Check } from "../src/commands/doctor.js";
import { runSaverChecks } from "../src/commands/doctor-saver.js";

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

let dir: string;
let storeRoot: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-doctor-saver-"));
  storeRoot = join(dir, "store");
  mkdirSync(storeRoot, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeHookSettings(saverCommand: string): string {
  const p = join(dir, "settings.json");
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "^(?:Bash)$",
            hooks: [
              { type: "command", command: saverCommand.replace("hooks saver", "hooks log"), timeout: 10 },
            ],
          },
        ],
        PostToolUse: [
          { matcher: "^(?:Bash)$", hooks: [{ type: "command", command: saverCommand, timeout: 30 }] },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: saverCommand.replace("hooks saver", "hooks intent"), timeout: 10 },
            ],
          },
        ],
      },
    }),
  );
  return p;
}

function fakeBinary(): string {
  const bin = join(dir, "mega");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  return bin;
}

// A stub "hook" that behaves like the real saver: it bumps the invocation
// heartbeat, then exits 0. cmd-aware so the E22.2 `--version` probe (which
// also goes through the spawn dep) does not advance the heartbeat before the
// self-test takes its `before` snapshot. Nothing is ever really spawned.
const advancingSpawn = (cmd: string) => {
  if (!cmd.endsWith("--version")) {
    recordInvocationHeartbeat(storeRoot, "wk-selftest", iso(NOW + 1000), NOW + 1000);
  }
  return { status: 0 };
};

const find = (checks: Check[], key: string) => checks.find((c) => c.key === key);

describe("runSaverChecks", () => {
  it("passes end-to-end with registered absolute hooks + an advancing heartbeat", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    recordInvocationHeartbeat(storeRoot, "wk-a", iso(NOW - 1000), NOW - 1000);
    const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW + 2000 });
    expect(find(checks, "saver-hooks-registered")?.pass).toBe(true);
    expect(find(checks, "saver-hook-binary")?.pass).toBe(true);
    expect(find(checks, "saver-self-test")?.pass).toBe(true);
    expect(find(checks, "saver-daemon")?.pass).toBe(true);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("FAILs the self-test on a non-zero exit with the repair hint", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const checks = runSaverChecks({ settingsPath, storeRoot, spawn: () => ({ status: 127 }), now: () => NOW });
    const selfTest = find(checks, "saver-self-test");
    expect(selfTest?.pass).toBe(false);
    expect(selfTest?.reason).toBe("run: mega hooks install");
  });

  it("FAILs registration when the saver hook is missing (and skips the dependent checks)", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ hooks: {} }));
    const checks = runSaverChecks({ settingsPath: p, storeRoot, spawn: () => ({ status: 0 }), now: () => NOW });
    const reg = find(checks, "saver-hooks-registered");
    expect(reg?.pass).toBe(false);
    expect(reg?.reason).toBe("run: mega hooks install");
    expect(find(checks, "saver-hook-binary")).toBeUndefined();
    expect(find(checks, "saver-self-test")).toBeUndefined();
  });

  it("WARNs (pass) when the hook never fired", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW });
    const liveness = find(checks, "saver-liveness");
    expect(liveness?.pass).toBe(true);
    expect(liveness?.reason).toContain("warn");
  });

  it("FAILs liveness when failures exist without a newer completion", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    recordInvocationHeartbeat(storeRoot, "wk-a", iso(NOW - 500), NOW - 500);
    recordFailureHeartbeat(storeRoot, "wk-a", "record", iso(NOW - 100), NOW - 100);
    const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW });
    expect(find(checks, "saver-liveness")?.pass).toBe(false);
  });

  it("WARNs on a store baked into the command that differs from the CLI store (E29)", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} --store "/other/store" hooks saver`);
    const checks = runSaverChecks({ settingsPath, storeRoot, spawn: advancingSpawn, now: () => NOW });
    const bake = find(checks, "saver-hook-store");
    expect(bake?.pass).toBe(true);
    expect(bake?.reason).toContain("split-brain");
  });

  it("WARNs when the registered binary reports a different --version (E22.2)", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const spawn = (cmd: string) =>
      cmd.endsWith("--version") ? { status: 0, stdout: "9.9.9\n" } : advancingSpawn(cmd);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn,
      now: () => NOW,
      cliVersion: "1.13.0",
    });
    const version = find(checks, "saver-hook-version");
    expect(version?.pass).toBe(true); // WARN, never FAIL
    expect(version?.value).toContain("9.9.9");
    expect(version?.value).toContain("1.13.0");
    expect(version?.reason).toContain("warn");
  });

  it("emits a clean version check (no warn) when versions match", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const spawn = (cmd: string) =>
      cmd.endsWith("--version") ? { status: 0, stdout: "1.13.0\n" } : advancingSpawn(cmd);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn,
      now: () => NOW,
      cliVersion: "1.13.0",
    });
    const version = find(checks, "saver-hook-version");
    expect(version?.pass).toBe(true);
    expect(version?.reason).toBeUndefined();
  });
});
```

- [ ] **Run to see RED.**

```bash
cd apps/cli && pnpm exec vitest run test/doctor-saver.test.ts > /tmp/t7-red.log 2>&1; echo RC=$?
```

Expected: RC=1 — `../src/commands/doctor-saver.js` does not exist, so all 8 tests (6 check tests + the 2 E22.2 version tests) fail at import.

- [ ] **Minimal implementation.**

**(a)** Create `apps/cli/src/commands/doctor-saver.ts`:

```ts
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hookCommandMatches } from "@megasaver/connector-claude-code";
import { readHeartbeatView } from "@megasaver/context-gate";
import { readDiscovery } from "@megasaver/daemon";
import { readStoreEnv, resolveStorePath } from "../store.js";
import type { Check } from "./doctor.js";
import { resolveClaudeCodeSettingsPath } from "./hooks/settings-path.js";

export type DoctorSaverDeps = {
  settingsPath?: string; // default ~/.claude/settings.json
  storeRoot?: string; // default: the CLI's resolved store
  spawn?: (
    cmd: string,
    stdinJson: string,
    timeoutMs: number,
  ) => { status: number | null; stdout?: string; error?: string };
  now?: () => number;
  cliVersion?: string; // default: the running CLI's own version (E22.2)
};

const SELF_TEST_TIMEOUT_MS = 10_000;
const REPAIR_HINT = "run: mega hooks install";

function defaultSpawn(
  cmd: string,
  stdinJson: string,
  timeoutMs: number,
): { status: number | null; stdout?: string; error?: string } {
  const r =
    process.platform === "win32"
      ? spawnSync(cmd, { shell: true, input: stdinJson, timeout: timeoutMs, encoding: "utf8" })
      : spawnSync("sh", ["-c", cmd], { input: stdinJson, timeout: timeoutMs, encoding: "utf8" });
  return {
    status: r.status,
    ...(typeof r.stdout === "string" ? { stdout: r.stdout } : {}),
    ...(r.error !== undefined ? { error: r.error.message } : {}),
  };
}

// Same version source as main.ts: the standalone bundle inlines
// __MEGA_CLI_VERSION__ at build time; the regular dist/cli.js bundle reads the
// sibling package.json ("../package.json" from dist/). Unresolvable (e.g.
// under vitest, where import.meta.url points into src/) → undefined, and the
// version sub-check is skipped — tests inject cliVersion explicitly.
declare const __MEGA_CLI_VERSION__: string | undefined;
function runningCliVersion(): string | undefined {
  if (typeof __MEGA_CLI_VERSION__ !== "undefined") return __MEGA_CLI_VERSION__;
  try {
    return (createRequire(import.meta.url)("../package.json") as { version: string }).version;
  } catch {
    return undefined;
  }
}

type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit";

function readSettingsSafe(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) return null;
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return null;
  }
}

function registeredCommand(settings: unknown, event: HookEvent, subcommand: string): string | null {
  if (typeof settings !== "object" || settings === null) return null;
  const entries = (settings as { hooks?: Record<string, unknown> }).hooks?.[event];
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const hooks = (entry as { hooks?: unknown }).hooks;
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) {
      const command = (h as { command?: unknown })?.command;
      if (typeof command === "string" && hookCommandMatches(command, subcommand)) return command;
    }
  }
  return null;
}

function firstToken(command: string): string {
  if (command.startsWith('"')) {
    const end = command.indexOf('"', 1);
    return end === -1 ? command : command.slice(1, end);
  }
  return command.split(/\s+/)[0] ?? "";
}

function bakedStore(command: string): string | null {
  const m = command.match(/--store\s+(?:"([^"]+)"|(\S+))/);
  return m === null ? null : (m[1] ?? m[2] ?? null);
}

// E22: doctor verifies the saver instead of trusting settings presence. WARN =
// pass:true + "warn:"-prefixed reason (never fails the exit code); FAIL =
// pass:false. No auto-fix — every finding prints its repair command.
export function runSaverChecks(deps: DoctorSaverDeps = {}): Check[] {
  const settingsPath = deps.settingsPath ?? resolveClaudeCodeSettingsPath();
  const storeRoot = deps.storeRoot ?? resolveStorePath(readStoreEnv(undefined));
  const spawn = deps.spawn ?? defaultSpawn;
  const now = deps.now ?? Date.now;
  const checks: Check[] = [];

  const settings = readSettingsSafe(settingsPath);
  const logCmd = registeredCommand(settings, "PreToolUse", "log");
  const saverCmd = registeredCommand(settings, "PostToolUse", "saver");
  const intentCmd = registeredCommand(settings, "UserPromptSubmit", "intent");

  // E22.1 registration — a missing saver is a FAIL; a missing telemetry/intent
  // hook or a bare PATH-dependent command is a warning.
  if (saverCmd === null) {
    checks.push({
      key: "saver-hooks-registered",
      value: "saver hook missing",
      pass: false,
      reason: REPAIR_HINT,
    });
  } else {
    const present = [logCmd, saverCmd, intentCmd].filter((c) => c !== null).length;
    const bare = firstToken(saverCmd) === "mega";
    checks.push({
      key: "saver-hooks-registered",
      value: `${present}/3`,
      pass: true,
      ...(present < 3
        ? { reason: `warn: log/intent hook missing — ${REPAIR_HINT}` }
        : bare
          ? { reason: `warn: bare "mega" command is PATH-dependent — ${REPAIR_HINT}` }
          : {}),
    });
  }

  if (saverCmd !== null) {
    // E22.2 binary — only checkable when the registered command is a path.
    const bin = firstToken(saverCmd);
    if (bin === "mega") {
      checks.push({ key: "saver-hook-binary", value: "skipped (bare command)", pass: true });
    } else {
      let ok = existsSync(bin);
      if (ok) {
        try {
          accessSync(bin, constants.X_OK);
        } catch {
          ok = false;
        }
      }
      checks.push(
        ok
          ? { key: "saver-hook-binary", value: bin, pass: true }
          : {
              key: "saver-hook-binary",
              value: `${bin} missing or not executable`,
              pass: false,
              reason: REPAIR_HINT,
            },
      );

      // E22.2 version sub-check: the registered binary's --version vs the
      // running CLI. WARN only — an upgrade lag is not a broken hook. Skipped
      // for bare commands (outer branch), when the CLI's own version is
      // unresolvable, or when the probe yields no output (a dead binary
      // already FAILed above).
      const cliVersion = deps.cliVersion ?? runningCliVersion();
      if (ok && cliVersion !== undefined) {
        const probe = spawn(`"${bin}" --version`, "", SELF_TEST_TIMEOUT_MS);
        const reported = probe.status === 0 ? (probe.stdout ?? "").trim() : "";
        if (reported !== "") {
          checks.push(
            reported === cliVersion
              ? { key: "saver-hook-version", value: reported, pass: true }
              : {
                  key: "saver-hook-version",
                  value: `hook ${reported} != cli ${cliVersion}`,
                  pass: true,
                  reason: `warn: version mismatch — ${REPAIR_HINT}`,
                },
          );
        }
      }
    }

    // E29 split-brain — the store baked into the command vs the CLI's store.
    // No bake means the hook resolves its own env default; only an explicit
    // divergent bake is a provable mismatch.
    const baked = bakedStore(saverCmd);
    checks.push(
      baked !== null && baked !== storeRoot
        ? {
            key: "saver-hook-store",
            value: `hook ${baked} != cli ${storeRoot}`,
            pass: true,
            reason: `warn: split-brain — ${REPAIR_HINT}`,
          }
        : { key: "saver-hook-store", value: baked ?? "default", pass: true },
    );
  }

  // E22.3 liveness from the heartbeat ledger.
  const view = readHeartbeatView(storeRoot, now());
  if (view.latest === null) {
    checks.push({
      key: "saver-liveness",
      value: "never fired",
      pass: true,
      reason: `warn: no invocation recorded — ${REPAIR_HINT}, then run any tool`,
    });
  } else {
    const failures = view.failures ?? {};
    const failing = Object.entries(failures).filter(([wk, f]) => {
      const completion = view.completions?.[wk];
      return f.count > 0 && (completion === undefined || Date.parse(completion) <= Date.parse(f.lastAt));
    });
    const totalFailures = Object.values(failures).reduce((n, f) => n + f.count, 0);
    const first = failing[0];
    if (first !== undefined) {
      const [wk, f] = first;
      checks.push({
        key: "saver-liveness",
        value: `failing (last ${f.lastKind} @ ${f.lastAt}, workspace ${wk})`,
        pass: false,
        reason: "no completion since the last failure — see: mega session saver resolve",
      });
    } else if (totalFailures > 0) {
      checks.push({
        key: "saver-liveness",
        value: `last invocation ${view.latest.ts}`,
        pass: true,
        reason: `warn: ${totalFailures} past hook failure(s), since recovered`,
      });
    } else {
      checks.push({ key: "saver-liveness", value: `last invocation ${view.latest.ts}`, pass: true });
    }
  }

  // E22.4 self-test — spawn the EXACT registered command with a synthetic
  // payload against the real store; assert exit 0 AND a heartbeat bump.
  // The tiny stdout stays under every floor, so the store is never grown
  // beyond the invocation heartbeat; GC retention prunes selftest residue.
  if (saverCmd !== null) {
    const before = readHeartbeatView(storeRoot, now()).latest?.ts ?? null;
    const payload = JSON.stringify({
      session_id: `doctor-selftest-${randomUUID()}`,
      tool_name: "Bash",
      cwd: process.cwd(),
      tool_response: { stdout: "x".repeat(200), stderr: "" },
    });
    const r = spawn(saverCmd, payload, SELF_TEST_TIMEOUT_MS);
    if (r.status !== 0) {
      checks.push({
        key: "saver-self-test",
        value: `exit ${r.status ?? "timeout"}${r.error !== undefined ? ` (${r.error})` : ""}`,
        pass: false,
        reason: REPAIR_HINT,
      });
    } else {
      const after = readHeartbeatView(storeRoot, now()).latest?.ts ?? null;
      const advanced = after !== null && (before === null || Date.parse(after) > Date.parse(before));
      checks.push(
        advanced
          ? { key: "saver-self-test", value: "exit 0, heartbeat advanced", pass: true }
          : {
              key: "saver-self-test",
              value: "exit 0 but no heartbeat",
              pass: false,
              reason: `hook ran but wrote no invocation heartbeat — check store wiring (${REPAIR_HINT})`,
            },
      );
    }
  }

  // E22.5 daemon — informational only; in-process fallback is by design.
  const disc = readDiscovery(storeRoot);
  checks.push({
    key: "saver-daemon",
    value:
      disc === null
        ? "not running (in-process fallback — by design)"
        : `running (pid ${disc.pid}, port ${disc.port})`,
    pass: true,
  });

  return checks;
}
```

**(b)** `apps/cli/src/commands/doctor.ts` — append the checks. Current imports end with:

```ts
import { HOOK_LOG_RELATIVE_PATH } from "../hooks/logger.js";
import { resolveClaudeCodeSettingsPath } from "./hooks/settings-path.js";
```

Replace with:

```ts
import { HOOK_LOG_RELATIVE_PATH } from "../hooks/logger.js";
import { runSaverChecks } from "./doctor-saver.js";
import { resolveClaudeCodeSettingsPath } from "./hooks/settings-path.js";
```

Current command `run()`:

```ts
  run() {
    const checks = runChecks();
    // Hook telemetry is informational: a "missing" result reports the install
    // hint but never fails the doctor (it is opt-in, not an environment fault),
    // so it is rendered below the env summary and excluded from exitCodeFor.
    const hookCheck = checkHookTelemetry(defaultHookTelemetryPaths());
    const hookLine =
      hookCheck.value === "installed"
        ? "\n\nClaude Code hook telemetry: installed"
        : `\n\nClaude Code hook telemetry: missing (${hookCheck.reason})`;
    console.log(`${renderReport(checks)}${hookLine}`);
    const code = exitCodeFor(checks);
    if (code !== 0) {
      process.exitCode = code;
    }
  },
```

Replace with:

```ts
  run() {
    // E22: environment checks + the saver verifier (registration, binary,
    // store bake, liveness, self-test, daemon). Saver FAILs affect the exit
    // code through the same exitCodeFor; warnings are pass:true with a reason.
    const checks = [...runChecks(), ...runSaverChecks()];
    // Hook telemetry is informational: a "missing" result reports the install
    // hint but never fails the doctor (it is opt-in, not an environment fault),
    // so it is rendered below the env summary and excluded from exitCodeFor.
    const hookCheck = checkHookTelemetry(defaultHookTelemetryPaths());
    const hookLine =
      hookCheck.value === "installed"
        ? "\n\nClaude Code hook telemetry: installed"
        : `\n\nClaude Code hook telemetry: missing (${hookCheck.reason})`;
    console.log(`${renderReport(checks)}${hookLine}`);
    const code = exitCodeFor(checks);
    if (code !== 0) {
      process.exitCode = code;
    }
  },
```

`runChecks()` itself is untouched (still the 3 env checks — its unit tests stay green).

- [ ] **Re-baseline `apps/cli/test/doctor.test.ts`** (the `describe("doctorCommand")` block already stubs HOME/USERPROFILE to a temp dir; add XDG isolation so the saver storeRoot is also deterministic). In its `beforeEach`, after the two existing `vi.stubEnv` calls, add:

```ts
    vi.stubEnv("XDG_DATA_HOME", join(tempHome, "xdg"));
```

With no hooks in the temp settings and an empty temp store, `runSaverChecks` deterministically yields: registration FAIL + liveness WARN (pass) + daemon pass → exactly 1 FAIL among 6 checks. Update two assertions:

- `expect(output).toContain("\n\n3 PASS / 0 FAIL");` → `expect(output).toContain("saver-hooks-registered"); expect(output).toMatch(/5 PASS \/ 1 FAIL/);`
- the test `"leaves process.exitCode at 0 on Node 22+"` → rename to `"sets exitCode 1 when the saver hook is not installed"` and assert `expect(process.exitCode).toBe(1);` after the run (keep resetting `process.exitCode = 0` in afterEach — already there).

- [ ] **Run GREEN.**

```bash
pnpm -s turbo build --filter @megasaver/cli... > /tmp/t7-build.log 2>&1; echo RC=$?
cd apps/cli && pnpm exec vitest run test/doctor-saver.test.ts test/doctor.test.ts > /tmp/t7-green.log 2>&1; echo RC=$?
```

Expected: RC=0.

- [ ] **Commit.**

```
feat(cli): doctor verifies saver end-to-end
```

## Task 8: `hooks status` keyspace union (E27) + cross-workspace aggregation (E28)

With an id: the memory-registry lookup stays; on a miss, fall back to the overlay keyspace and render a "Live hook session (overlay)" block; only a double miss keeps the existing "session not found" (exit 1). With NO id (new): print per-workspace totals, a TOTAL line, and heartbeat recency. The CLI reads all stats surfaces through `@megasaver/core` re-exports (`readOverlaySummaryAnyWorkspace`, `readWorkspaceTokenSaverTotals`, `readAllWorkspaceTokenSaverTotals` — all verified already re-exported) and the heartbeat through `@megasaver/context-gate`.

**Files:**
- Modify: `apps/cli/src/commands/hooks/status.ts`
- Test: `apps/cli/test/hooks/status.test.ts` (extend)

**Steps:**

- [ ] **Write the failing tests.** Append to `apps/cli/test/hooks/status.test.ts`. Add two imports at the top (below the existing ones):

```ts
import { recordInvocationHeartbeat } from "@megasaver/context-gate";
```

Then append:

```ts
const OVERLAY_ID = "33333333-3333-4333-8333-333333333333";
const WK1 = "wk-alpha";
const WK2 = "wk-beta";

async function seedOverlaySummary(
  wk: string,
  id: string,
  eventsTotal: number,
  bytesSaved: number,
): Promise<void> {
  await mkdir(join(store, "stats", wk), { recursive: true });
  await writeFile(
    join(store, "stats", wk, `${id}.json`),
    JSON.stringify({
      liveSessionId: id,
      eventsTotal,
      rawBytesTotal: bytesSaved + 100,
      returnedBytesTotal: 100,
      bytesSavedTotal: bytesSaved,
      savingRatio: bytesSaved / (bytesSaved + 100),
      secretsRedactedTotal: 0,
      chunksStoredTotal: 1,
      updatedAt: "2026-07-10T00:00:00.000Z",
    }),
  );
}

type StatusOverrides = { sessionId?: string; json?: boolean };
async function runStatus(overrides: StatusOverrides = {}): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runHooksStatus({
    ...(overrides.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
    storeFlag: store,
    cwd: store,
    home: "/tmp",
    xdgDataHome: undefined,
    platform: "linux",
    localAppData: undefined,
    hookLogPath: join(store, "none.jsonl"),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    json: overrides.json ?? false,
  });
  return { out, err, code };
}

describe("runHooksStatus — overlay keyspace union (E27)", () => {
  it("renders an overlay-backed block for a hook-only session id", async () => {
    await seedOverlaySummary(WK1, OVERLAY_ID, 2, 900);
    const { out, err, code } = await runStatus({ sessionId: OVERLAY_ID });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Live hook session (overlay)");
    expect(text).toContain(WK1);
    expect(text).toContain("events: 2");
    expect(err).toHaveLength(0);
  });

  it("emits the overlay summary as JSON with its source label", async () => {
    await seedOverlaySummary(WK1, OVERLAY_ID, 2, 900);
    const { out, code } = await runStatus({ sessionId: OVERLAY_ID, json: true });
    expect(code).toBe(0);
    const p = JSON.parse(out.join("\n"));
    expect(p.source).toBe("overlay");
    expect(p.workspaceKey).toBe(WK1);
    expect(p.eventsTotal).toBe(2);
  });

  it("still reports session not found when BOTH keyspaces miss", async () => {
    const { err, code } = await runStatus({
      sessionId: "44444444-4444-4444-8444-444444444444",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("not found");
  });
});

describe("runHooksStatus — cross-workspace aggregate (E28, no-arg form)", () => {
  it("sums totals across workspace keys and prints heartbeat recency", async () => {
    await seedOverlaySummary(WK1, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 2, 900);
    await seedOverlaySummary(WK2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 3, 100);
    const ts = new Date(Date.now() - 1000).toISOString();
    recordInvocationHeartbeat(store, WK1, ts);
    const { out, code } = await runStatus();
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(`${WK1}: 1 sessions, 2 events, saved 900 B`);
    expect(text).toContain(`${WK2}: 1 sessions, 3 events, saved 100 B`);
    expect(text).toContain("TOTAL: 2 sessions across 2 workspaces, saved 1000 B");
    expect(text).toContain(`${WK1}: invoked ${ts}, completed never, failures 0`);
  });

  it("renders an empty store without erroring", async () => {
    const { out, code } = await runStatus();
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no hook sessions recorded");
  });
});
```

- [ ] **Run to see RED.**

```bash
cd apps/cli && pnpm exec vitest run test/hooks/status.test.ts > /tmp/t8-red.log 2>&1; echo RC=$?
```

Expected: RC=1 — the no-arg calls fail type-check (`sessionId` is required today) and the overlay-only id yields `error: session "…" not found` / exit 1.

- [ ] **Minimal implementation.** Modify `apps/cli/src/commands/hooks/status.ts`.

**(a)** Imports. Current:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProxyMetrics, StatsError, buildProxyMetrics, readEvents } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
```

Replace with:

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readHeartbeatView } from "@megasaver/context-gate";
import {
  type OverlaySessionTokenSaverStats,
  type ProxyMetrics,
  StatsError,
  type WorkspaceTokenSaverTotals,
  buildProxyMetrics,
  readAllWorkspaceTokenSaverTotals,
  readEvents,
  readOverlaySummaryAnyWorkspace,
  readWorkspaceTokenSaverTotals,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
```

**(b)** Input type. Current:

```ts
export type RunHooksStatusInput = {
  sessionId: string;
```

Replace with:

```ts
export type RunHooksStatusInput = {
  sessionId?: string; // absent → cross-workspace aggregate view (E28)
```

**(c)** New render helpers — insert after the existing `renderText` function:

```ts
// E27: an overlay session (keyed by Claude transcript UUID) is registered
// nowhere — the overlay files ARE the registration; label it explicitly.
function renderOverlayStatus(
  overlay: { workspaceKey: string; summary: OverlaySessionTokenSaverStats },
  input: RunHooksStatusInput,
): void {
  const s = overlay.summary;
  if (input.json) {
    input.stdout(JSON.stringify({ source: "overlay", workspaceKey: overlay.workspaceKey, ...s }));
    return;
  }
  const pct = s.rawBytesTotal === 0 ? "0.0" : ((s.bytesSavedTotal / s.rawBytesTotal) * 100).toFixed(1);
  input.stdout("Live hook session (overlay):");
  input.stdout(`  workspace: ${overlay.workspaceKey}`);
  input.stdout(`  events: ${s.eventsTotal}`);
  input.stdout(`  bytes: ${s.rawBytesTotal} raw -> ${s.returnedBytesTotal} returned (saved ${pct}%)`);
  input.stdout(`  updated: ${s.updatedAt}`);
}

// E28: no-arg form — per-workspace totals + TOTAL + heartbeat recency. Reads
// only the stats tree and the heartbeat registry; needs no session registry.
function runAggregateStatus(rootDir: string, input: RunHooksStatusInput): 0 {
  const store = { root: rootDir };
  let workspaceKeys: string[];
  try {
    workspaceKeys = readdirSync(join(rootDir, "stats"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    workspaceKeys = [];
  }
  const perWorkspace: WorkspaceTokenSaverTotals[] = [];
  for (const wk of workspaceKeys) {
    try {
      const totals = readWorkspaceTokenSaverTotals(store, wk);
      if (totals !== null) perWorkspace.push(totals);
    } catch {
      // unsafe segment or unreadable dir — skip, mirroring the stats readers
    }
  }
  const total = readAllWorkspaceTokenSaverTotals(store);
  const hb = readHeartbeatView(rootDir);

  if (input.json) {
    input.stdout(JSON.stringify({ workspaces: perWorkspace, total, heartbeat: hb }));
    return 0;
  }
  const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
  input.stdout("Hook savings by workspace:");
  if (perWorkspace.length === 0) input.stdout("  (no hook sessions recorded)");
  for (const t of perWorkspace) {
    input.stdout(
      `  ${t.workspaceKey}: ${t.sessionsCount} sessions, ${t.eventsTotal} events, saved ${t.bytesSavedTotal} B (${pct(t.savingRatio)})`,
    );
  }
  input.stdout(
    `  TOTAL: ${total.sessionsCount} sessions across ${total.workspaceCount} workspaces, saved ${total.bytesSavedTotal} B (${pct(total.savingRatio)})`,
  );
  input.stdout("");
  input.stdout("Hook liveness by workspace:");
  const wks = Object.keys(hb.workspaces).sort();
  if (wks.length === 0) input.stdout("  (no heartbeats recorded)");
  for (const wk of wks) {
    input.stdout(
      `  ${wk}: invoked ${hb.workspaces[wk] ?? "?"}, completed ${hb.completions?.[wk] ?? "never"}, failures ${hb.failures?.[wk]?.count ?? 0}`,
    );
  }
  return 0;
}
```

**(d)** The `runHooksStatus` body. Current (after store resolution):

```ts
  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
```

Replace with:

```ts
  if (input.sessionId === undefined) {
    return runAggregateStatus(rootDir, input);
  }

  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
```

And the current registry-miss branch:

```ts
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
```

Replace with:

```ts
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      // E27 keyspace union: the hook writes the overlay keyspace (Claude
      // transcript UUIDs), the registry holds memory sessions — try the
      // second keyspace before declaring the id unknown.
      const overlay = readOverlaySummaryAnyWorkspace({ root: rootDir }, parsedSessionId);
      if (overlay !== null) {
        renderOverlayStatus(overlay, input);
        return 0;
      }
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
```

**(e)** The citty command. Current:

```ts
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    "hook-log": { type: "string", description: "Override Claude Code hook log path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runHooksStatus({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
```

Replace with:

```ts
  args: {
    sessionId: {
      type: "positional",
      required: false,
      description: "Session id (UUID). Omit for the cross-workspace aggregate view.",
    },
    store: { type: "string", description: "Override store directory." },
    "hook-log": { type: "string", description: "Override Claude Code hook log path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runHooksStatus({
      ...(typeof args.sessionId === "string" ? { sessionId: args.sessionId } : {}),
```

(also update the command `description` to mention the aggregate: `"Show proxy adoption metrics for a session, resolve live hook (overlay) sessions, or — with no id — aggregate hook savings across workspaces."`).

- [ ] **Run GREEN.**

```bash
cd apps/cli && pnpm exec vitest run test/hooks/status.test.ts > /tmp/t8-green.log 2>&1; echo RC=$?
```

Expected: RC=0 — the pre-existing adoption/interception tests (they always pass a sessionId) plus the 5 new ones.

- [ ] **Commit.**

```
feat(cli): hooks status overlay + aggregate view
```

---

## Task 9: proxy read-index guard test (test-only, no production change)

Pins the only prior-content path in the codebase (2026-07-10 corruption forensics): `runOutputPipeline` (`packages/context-gate/src/run.ts:121-130`) and `runOverlayOutputPipeline` (`run.ts:300-311`) short-circuit to `unchangedResult(prior.chunkSetId, raw)` **iff** `loadReadIndex(sessionDir)[hashPath(abs)]?.contentHash === hashContent(raw)`, and refresh the index via `recordRead(sessionDir, pathHash, { contentHash, chunkSetId })` (`run.ts:186`). Invoking `runOutputPipeline` itself needs a registry + permissions + filter + chunk-store stack; this test pins the exact decision seam both callers consume, mirroring their consumption byte-for-byte — which is why it lives next to the existing `read-index.test.ts` helper tests.

**Files:**
- Test: `packages/context-gate/test/read-index-invalidation.test.ts` (new; no production files touched)

**Steps:**

- [ ] **Write the test.** Create `packages/context-gate/test/read-index-invalidation.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, hashPath, loadReadIndex, recordRead } from "../src/read-index.js";

let sessionDir: string;
beforeEach(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "mega-readidx-guard-"));
});
afterEach(() => {
  rmSync(sessionDir, { recursive: true, force: true });
});

// Guard for the read-index short-circuit in run.ts (runOutputPipeline :121-130,
// runOverlayOutputPipeline :300-311): a re-read whose content CHANGED must
// never be served the prior chunk set. Mirrors exactly how run.ts consumes the
// helpers: prior = loadReadIndex(dir)[hashPath(abs)]; short-circuit iff
// prior.contentHash === hashContent(raw); fresh path calls recordRead (:186).
describe("read-index short-circuit invalidation (proxy guard)", () => {
  const ABS = "/repo/src/app.ts";
  const V1 = "export const a = 1;\n";
  const V2 = "export const a = 2;\n";

  it("changed content MUST NOT short-circuit to the prior chunk set", () => {
    const pathHash = hashPath(ABS);
    recordRead(sessionDir, pathHash, { contentHash: hashContent(V1), chunkSetId: "cs-v1" });
    // exactly the run.ts comparison:
    const prior = loadReadIndex(sessionDir)[pathHash];
    const shortCircuits = prior !== undefined && prior.contentHash === hashContent(V2);
    expect(shortCircuits).toBe(false);
    // the fresh-read path then refreshes the index (run.ts:186):
    recordRead(sessionDir, pathHash, { contentHash: hashContent(V2), chunkSetId: "cs-v2" });
    expect(loadReadIndex(sessionDir)[pathHash]).toEqual({
      contentHash: hashContent(V2),
      chunkSetId: "cs-v2",
    });
  });

  it("unchanged content DOES short-circuit to the prior chunk set", () => {
    const pathHash = hashPath(ABS);
    recordRead(sessionDir, pathHash, { contentHash: hashContent(V1), chunkSetId: "cs-v1" });
    const prior = loadReadIndex(sessionDir)[pathHash];
    const shortCircuits = prior !== undefined && prior.contentHash === hashContent(V1);
    expect(shortCircuits).toBe(true);
    expect(prior?.chunkSetId).toBe("cs-v1");
  });

  it("outline reads key a separate slot — a full-read marker cannot suppress an outline", () => {
    // run.ts keys outline reads as hashPath(`${abs}\0outline`); the \0 separator
    // is illegal in filesystem paths on every OS so it can never collide.
    recordRead(sessionDir, hashPath(ABS), { contentHash: hashContent(V1), chunkSetId: "cs-full" });
    expect(loadReadIndex(sessionDir)[hashPath(`${ABS}\0outline`)]).toBeUndefined();
  });
});
```

- [ ] **Run — and prove the guard can fail.** A guard test pins existing (correct) behavior, so it is GREEN on first run; RED-discipline is satisfied by a one-off mutation check. Run:

```bash
cd packages/context-gate && pnpm exec vitest run test/read-index-invalidation.test.ts > /tmp/t9-green.log 2>&1; echo RC=$?
```

Expected: RC=0. Then temporarily flip `hashContent(V2)` to `hashContent(V1)` in the first test's comparison, re-run, confirm RC=1 (the assertion trips), and revert. This proves the test detects a broken invalidation rather than passing vacuously.

- [ ] **Commit.**

```
test(context-gate): pin read-index invalidation
```

---

## Task 10: changeset + wiki + full verify

**Files:**
- Create: `.changeset/saver-observability-wave4.md`
- Modify: `wiki/log.md` (append entry)

**Steps:**

- [ ] **Create the changeset.** `.changeset/saver-observability-wave4.md` (note: `@megasaver/core` is included because Task 4 grew its public re-export surface):

```md
---
"@megasaver/shared": minor
"@megasaver/context-gate": minor
"@megasaver/stats": minor
"@megasaver/connector-claude-code": minor
"@megasaver/core": minor
"@megasaver/cli": minor
---

Saver observability wave 4 (E21-E29): a dead saver is now visible. The
per-workspace heartbeat registry becomes a full liveness ledger — hook
failures (with a coarse kind), successful completions, and daemon
fallbacks are recorded best-effort and surfaced in `mega session saver
resolve`, `mega hooks status`, and a new `mega doctor` verifier section
(registration, binary, store bake, heartbeat liveness, spawned self-test,
daemon ping). Corrupt per-session overlay summaries self-heal from their
events JSONL (stamped `rebuiltAt`); summary read-modify-writes are
serialized by a new stale-aware `withFileLock` in `@megasaver/shared`
(which also unfreezes the heartbeat lock), and the daily GC sweep
reconciles summaries that lag their JSONL. `mega hooks install` now
registers hooks by absolute CLI path with explicit timeouts, bakes
`--store` for non-default stores, and migrates legacy bare entries in
place; `mega hooks status <id>` also resolves live overlay sessions, and
the no-arg form aggregates savings and liveness across workspaces.
```

- [ ] **Append the wiki log entry.** Append to `wiki/log.md` (replace `<verify-commit>` with the actual HEAD short hash after the verify step passes):

```md
## [2026-07-10] feat | Saver observability wave 4 (E21-E29)

Branch `feat/saver-observability` (worktree). Theme E of the audit fixed:
a dead saver no longer looks healthy.

- E21: heartbeat registry grew parallel ledgers — `completions` (strict-newer
  per workspace), `failures` ({count, lastAt, lastKind} with coarse kind
  payload/resolve/record/unknown; count never lost), `daemonFallbacks`.
  Written best-effort from buildSaverDecision's new wrapper (completion on
  every non-throwing finish, failure with stage on throw) and makeRecord's
  daemon-POST-failed branch. Surfaced in `mega session saver resolve` (two
  text lines + three JSON fields).
- E25/E26: new `withFileLock(lockPath, {deadlineMs, staleMs}, fn)` in
  @megasaver/shared (its first fs module) — a lock file older than staleMs
  (5 s) is stolen as dead-holder residue. Heartbeat lock delegates to it
  (10 ms deadline kept); appendOverlayEvent's summary read-modify-write runs
  under `<summary>.lock` (50 ms deadline; on contention the summary write is
  skipped — the JSONL line is already durable).
- E24: overlay summaries self-heal — a corrupt summary is rebuilt from the
  corruption-tolerant events JSONL and stamped `rebuiltAt`
  (secretsRedactedTotal/chunksStoredTotal reset to 0: events do not carry
  them — a documented liveness trade). The daily GC sweep now runs
  reconcileOverlaySummaries: any summary that fails schema or whose
  eventsTotal lags its JSONL line count is rebuilt (repairs E26 lock-skips
  permanently).
- E23/E29: hook commands are registered as the absolute invoked CLI path
  (argv[1] launcher, quoted iff whitespace) with explicit timeouts (saver
  30 s, log/intent 10 s); a non-default store is baked as `--store "<abs>"`.
  Matching is by `hooks <sub>` suffix, so re-install migrates legacy bare
  entries in place and uninstall removes every historical form.
- E22: `mega doctor` gained runSaverChecks — registration (missing saver =
  FAIL, exit 1), binary exists+X_OK plus a --version-vs-CLI-version WARN
  sub-check, baked-store vs CLI-store split-brain
  WARN, heartbeat liveness (failures without a newer completion = FAIL),
  self-test (spawns the exact registered command with a synthetic
  doctor-selftest payload, asserts exit 0 + heartbeat advance), daemon ping
  (INFO only, via discovery file).
- E27/E28: `mega hooks status <id>` falls back to the overlay keyspace and
  renders a labeled "Live hook session (overlay)" block; the new no-arg form
  prints per-workspace totals, a TOTAL line, and per-workspace heartbeat
  recency (invoked/completed/failures).
- Guard test pins the proxy read-index short-circuit seam (changed content
  must never reuse the prior chunk set; outline slot separate).

Verification: `pnpm verify` green at <verify-commit>. Plan:
docs/superpowers/plans/2026-07-10-saver-observability-plan.md. Spec:
docs/superpowers/specs/2026-07-10-saver-observability-design.md.
```

- [ ] **Run the full gate.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-observability && pnpm verify > /tmp/verify.log 2>&1; echo RC=$?
```

RC MUST be 0. On failure, read `/tmp/verify.log` in ≤70-line slices (`sed -n '1,70p' /tmp/verify.log`, then the failing region), fix, re-run. Do not proceed to commit until RC=0. Then fill `<verify-commit>` in the wiki entry with `git rev-parse --short HEAD`.

- [ ] **Commit docs + changeset.**

```
docs(saver): wave 4 changeset + wiki log
```

---

## Execution order & dependency notes

- Strict order T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8; T9 is independent (any time after T1); T10 last.
- Rebuild `dist/` between package boundaries: after T1 (`--filter @megasaver/context-gate...`), after T2 (`--filter @megasaver/cli...` covers stats/core/cli), after T4 (core re-export), after T6 (connector).
- Expected re-baselines (all listed in-task): `saver-heartbeat.test.ts` (imports only), `saver.test.ts` `deps()` helper, `hook-settings.test.ts` / `install.test.ts` timeout fields, `doctor.test.ts` doctorCommand block. Nothing else should need edits — if another test breaks, stop and diagnose before touching it (superpowers:systematic-debugging).
- Per-workspace failure ledger writes happen on the hook's fail-open path only; nothing in this wave changes what the model sees in tool outputs (§13.4 posture intact).

## Contract adjustments vs. the architect brief (verified against real code)

1. **CLI never imports `@megasaver/stats` directly** — `apps/cli/package.json` has no stats dep and `dependency-graph.test.ts` enforces the §3c allow-list. `reconcileOverlaySummaries` is therefore re-exported through `@megasaver/core` (T4d) and `gc.ts` imports it from core, not stats.
2. **`@megasaver/core` added to the changeset** (its public surface grew by one re-export).
3. **Doctor "binary" check skips bare commands** (`existsSync("mega")` would false-FAIL a PATH-resolvable bare form; bare is already WARNed by the registration check).
4. **Doctor store-bake check WARNs only on an explicit divergent bake** — with no bake the hook resolves its own environment default, which the doctor process cannot observe, so equality with the CLI store is not provable.
5. **Doctor daemon "ping" reads the discovery file synchronously** (`readDiscovery`) instead of an HTTP ping — `runSaverChecks` is contractually synchronous (`(deps?) => Check[]`), and `getRunningDaemon` is async. INFO-only either way.
6. **`hooks status` no-arg form replaces (not follows) the per-session output** — the current command requires a session id, so there is no "existing output" in the no-arg case; the aggregate view is the whole output.
7. **Completion records on every non-throwing finish** (including passthrough decisions), not only on compressions — per the spec, completion proves the hook *finished*; the invocation/completion gap is the crash signal.
8. **`buildSaverDecision` restructured as wrapper + private `decide()`** so a single completion/failure site covers all ~9 return paths without touching each one.

