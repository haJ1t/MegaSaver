# Session Mesh v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent sessions in different terminals discover each other, exchange messages, claim files with conflict warnings, and are observable via `mega mesh status` — files as source of truth, daemon as optional accelerator.

**Architecture:** New leaf package `@megasaver/mesh` owns all mesh state under `<storeRoot>/mesh/` (presence, append-only events, advisory claims, per-session inboxes; atomic writes + advisory locks). Consumers: three existing CLI hook handlers piggyback mesh calls (no new hook processes, no settings.json changes), new `mega mesh` CLI commands, 7 new MCP bridge tools, one new daemon route.

**Tech Stack:** TypeScript strict ESM, Zod, vitest, citty; `withFileLock` from `@megasaver/shared/node`; `redact` + `compileGlob` from `@megasaver/policy`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-session-mesh-design.md` (risk HIGH — worktree `feat/session-mesh`, code-reviewer AND critic passes required).
- Fail-open: no mesh failure may block or break the agent's real work; hook-side calls are wrapped, always exit 0.
- No new hook processes and no settings.json changes in v1 (piggyback `warmup-run` / `saver-run` / `guard-run` only).
- Claims are advisory and warn-only; TTL 30 min, refreshed by heartbeat.
- All user text through `redact()` from `@megasaver/policy` before persist.
- Staleness: stale > 90 s, dead > 10 min, from `lastSeenAt` only; never touch a process we did not start.
- Inbox delivery at-most-once via atomic `rename`; drain cap 5 messages / 2 000 tokens.
- events.jsonl: append-only; rotation at 5 MB or 7 days; torn lines skipped on read.
- `@megasaver/mesh` deps: `@megasaver/shared` + `@megasaver/policy` + `zod` only (no core edge; mirrors decisions/content-store-no-core-edge).
- Windows-safe: no `fs.watch` on any truth path; `mkdir {mode:0o700}`, files `0o600`; dir-fsync skipped on win32 (content-store atomic-write precedent).
- All timestamps ISO-8601 with offset via injected `now?: () => string`; ids via injected `newId?: () => string` (house pattern — shared has validators, not generators).
- Enum declaration order is a contract (AA3): never reorder published enums.

---

### Task 1: Package scaffold + record schemas

**Files:**
- Create: `packages/mesh/package.json`, `packages/mesh/tsconfig.json`, `packages/mesh/vitest.config.ts`, `packages/mesh/src/index.ts`, `packages/mesh/src/types.ts`, `packages/mesh/src/error.ts`
- Test: `packages/mesh/test/types.test.ts`

**Interfaces:**
- Consumes: `zod`; `workspaceKeySchema` pattern from `packages/shared/src/workspace-key.ts` (regex reproduced, not imported, to keep schemas self-describing); `repositoryFamilyKeySchema` regex from `packages/shared/src/repository-family-key.ts`.
- Produces: `presenceRecordSchema`/`PresenceRecord`, `meshEventSchema`/`MeshEvent`, `claimRecordSchema`/`ClaimRecord`, `meshMessageSchema`/`MeshMessage`, `meshStatusSchema`/`MeshStatus`, `safeSegmentSchema`, `MeshError`, constants module.

- [ ] **Step 1: Write the failing test**

```ts
// packages/mesh/test/types.test.ts
import { describe, expect, it } from "vitest";
import {
  claimRecordSchema, meshEventSchema, meshMessageSchema,
  meshStatusSchema, presenceRecordSchema, safeSegmentSchema,
} from "../src/types.js";

const NOW = "2026-08-06T12:00:00.000+03:00";

describe("mesh record schemas", () => {
  it("accepts a full presence record and rejects unknown keys", () => {
    const rec = {
      liveSessionId: "abc-123", workspaceKey: "0123456789abcdef",
      agent: "claude-code", cwd: "/repo", status: "working",
      registeredAt: NOW, lastSeenAt: NOW,
    };
    expect(presenceRecordSchema.parse(rec)).toEqual(rec);
    expect(() => presenceRecordSchema.parse({ ...rec, extra: 1 })).toThrow();
  });
  it("rejects unsafe path segments for liveSessionId", () => {
    expect(() => safeSegmentSchema.parse("../evil")).toThrow();
    expect(() => presenceRecordSchema.parse({
      liveSessionId: "../x", workspaceKey: "0123456789abcdef",
      agent: "a", cwd: "/r", status: "idle", registeredAt: NOW, lastSeenAt: NOW,
    })).toThrow();
  });
  it("pins the status enum order", () => {
    expect(meshStatusSchema.options).toEqual(["working", "blocked", "idle", "done"]);
  });
  it("validates events, claims, and messages", () => {
    expect(meshEventSchema.parse({
      id: "e1", kind: "message", liveSessionId: "s1",
      workspaceKey: "0123456789abcdef", at: NOW, to: "s2", text: "hi",
    }).kind).toBe("message");
    expect(claimRecordSchema.parse({
      claimId: "c1", liveSessionId: "s1", workspaceKey: "0123456789abcdef",
      paths: ["src/a.ts"], createdAt: NOW, refreshedAt: NOW,
      expiresAt: "2026-08-06T12:30:00.000+03:00",
    }).paths).toEqual(["src/a.ts"]);
    expect(meshMessageSchema.parse({
      id: "m1", from: "s1", to: "s2", kind: "ask", text: "which config?", at: NOW,
    }).kind).toBe("ask");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mesh test`
Expected: FAIL — package does not exist yet / cannot resolve `../src/types.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/mesh/package.json` (mirror a leaf package, e.g. `packages/content-store/package.json`, for tsup/scripts):

```json
{
  "name": "@megasaver/mesh",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "build": "tsup src/index.ts --format esm --dts", "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@megasaver/policy": "workspace:*", "@megasaver/shared": "workspace:*", "zod": "^3.23.8" },
  "devDependencies": { "tsup": "catalog:", "typescript": "catalog:", "vitest": "catalog:" }
}
```

(Copy exact `zod`/catalog versions from `packages/content-store/package.json` at implementation time — do not bump anything.) `tsconfig.json` extends `../../tsconfig.base.json`; `vitest.config.ts` mirrors the per-package pattern (`include: ["test/**/*.test.ts"]`, `testTimeout: 30_000`).

```ts
// packages/mesh/src/error.ts
export type MeshErrorCode =
  | "schema_invalid" | "write_failed" | "not_found" | "unsafe_segment";
export class MeshError extends Error {
  readonly code: MeshErrorCode;
  constructor(code: MeshErrorCode, message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "MeshError";
    this.code = code;
  }
}
```

```ts
// packages/mesh/src/types.ts
import { z } from "zod";

// Path-segment guard: same shape stats uses (packages/stats/src/event.ts:8).
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const safeSegmentSchema = z.string().regex(SAFE_SEGMENT, "unsafe path segment");

export const meshStatusSchema = z.enum(["working", "blocked", "idle", "done"]);
export type MeshStatus = z.infer<typeof meshStatusSchema>;

const isoDateTime = z.string().datetime({ offset: true });
const workspaceKey = z.string().regex(/^[0-9a-f]{16}$/, "workspaceKey must be 16 lowercase hex chars");

export const presenceRecordSchema = z.object({
  liveSessionId: safeSegmentSchema,
  workspaceKey,
  repositoryFamilyKey: z.string().regex(/^gf1_[A-Za-z0-9_-]{43}$/).optional(),
  agent: z.string().min(1).max(64),
  cwd: z.string().min(1),
  branch: z.string().max(256).optional(),
  taskLabel: z.string().max(256).optional(),
  status: meshStatusSchema,
  registeredAt: isoDateTime,
  lastSeenAt: isoDateTime,
}).strict();
export type PresenceRecord = z.infer<typeof presenceRecordSchema>;

export const meshEventKindSchema = z.enum(
  ["register", "status", "message", "ask", "answer", "claim", "release", "done"],
);
export const meshEventSchema = z.object({
  id: z.string().min(1),
  kind: meshEventKindSchema,
  liveSessionId: safeSegmentSchema,
  workspaceKey,
  at: isoDateTime,
  to: safeSegmentSchema.optional(),
  text: z.string().max(4_000).optional(),
  claimId: safeSegmentSchema.optional(),
}).strict();
export type MeshEvent = z.infer<typeof meshEventSchema>;

export const claimRecordSchema = z.object({
  claimId: safeSegmentSchema,
  liveSessionId: safeSegmentSchema,
  workspaceKey,
  paths: z.array(z.string().min(1).max(1_024)).min(1).max(64),
  intent: z.string().max(256).optional(),
  createdAt: isoDateTime,
  refreshedAt: isoDateTime,
  expiresAt: isoDateTime,
}).strict();
export type ClaimRecord = z.infer<typeof claimRecordSchema>;

export const meshMessageSchema = z.object({
  id: safeSegmentSchema,
  from: safeSegmentSchema,
  to: safeSegmentSchema,
  kind: z.enum(["message", "ask", "answer"]),
  text: z.string().min(1).max(4_000),
  at: isoDateTime,
  provenance: z.string().max(512).optional(),
}).strict();
export type MeshMessage = z.infer<typeof meshMessageSchema>;
```

`src/index.ts` re-exports all of the above. Add the package to `pnpm-workspace.yaml` globs if not already matched by `packages/*`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @megasaver/mesh test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mesh pnpm-lock.yaml
git commit -m "feat(mesh): scaffold package with record schemas"
```

---

### Task 2: Store paths, constants, atomic write, quarantine

**Files:**
- Create: `packages/mesh/src/paths.ts`, `packages/mesh/src/constants.ts`, `packages/mesh/src/atomic-write.ts`, `packages/mesh/src/quarantine.ts`
- Test: `packages/mesh/test/paths.test.ts`, `packages/mesh/test/atomic-write.test.ts`

**Interfaces:**
- Consumes: `safeSegmentSchema`, `MeshError` (Task 1).
- Produces: `meshDir(storeRoot)`, `presenceDir(storeRoot)`, `presencePath(storeRoot, liveSessionId)`, `eventsPath(storeRoot)`, `claimsDir(storeRoot)`, `claimPath(storeRoot, claimId)`, `inboxDir(storeRoot, liveSessionId)`, `quarantineDir(storeRoot)`; `atomicWriteFile(filePath: string, content: string): void` (throws `MeshError("write_failed")`); `readJsonOrQuarantine<T>(path: string, schema: ZodType<T>, storeRoot: string): T | undefined`; constants `STALE_AFTER_MS = 90_000`, `DEAD_AFTER_MS = 600_000`, `CLAIM_TTL_MS = 1_800_000`, `HEARTBEAT_DEBOUNCE_MS = 5_000`, `EVENTS_MAX_BYTES = 5 * 1024 * 1024`, `EVENTS_MAX_AGE_MS = 604_800_000`, `DRAIN_MAX_MESSAGES = 5`, `DRAIN_MAX_TOKENS = 2_000`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/mesh/test/paths.test.ts
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { inboxDir, meshDir, presencePath } from "../src/paths.js";

describe("mesh paths", () => {
  it("builds paths under <storeRoot>/mesh and rejects unsafe segments", () => {
    expect(meshDir("/s")).toBe(join("/s", "mesh"));
    expect(presencePath("/s", "sess-1")).toBe(join("/s", "mesh", "presence", "sess-1.json"));
    expect(inboxDir("/s", "sess-1")).toBe(join("/s", "mesh", "inbox", "sess-1"));
    expect(() => presencePath("/s", "../evil")).toThrow(/unsafe/);
  });
});
```

```ts
// packages/mesh/test/atomic-write.test.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { atomicWriteFile } from "../src/atomic-write.js";
import { readJsonOrQuarantine } from "../src/quarantine.js";
import { quarantineDir } from "../src/paths.js";
import { existsSync, readdirSync } from "node:fs";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "megasaver-mesh-aw-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("atomic write + quarantine", () => {
  it("writes atomically and reads back", () => {
    const p = join(root, "mesh", "presence", "a.json");
    atomicWriteFile(p, '{"x":1}\n');
    expect(readFileSync(p, "utf8")).toBe('{"x":1}\n');
  });
  it("quarantines a corrupt json file and returns undefined", () => {
    const p = join(root, "mesh", "presence", "bad.json");
    atomicWriteFile(p, "{not json");
    const out = readJsonOrQuarantine(p, z.object({ x: z.number() }).strict(), root);
    expect(out).toBeUndefined();
    expect(existsSync(p)).toBe(false);
    expect(readdirSync(quarantineDir(root)).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/mesh test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mesh/src/constants.ts
export const STALE_AFTER_MS = 90_000;
export const DEAD_AFTER_MS = 600_000;
export const CLAIM_TTL_MS = 1_800_000;
export const HEARTBEAT_DEBOUNCE_MS = 5_000;
export const EVENTS_MAX_BYTES = 5 * 1024 * 1024;
export const EVENTS_MAX_AGE_MS = 604_800_000;
export const DRAIN_MAX_MESSAGES = 5;
export const DRAIN_MAX_TOKENS = 2_000;
```

```ts
// packages/mesh/src/paths.ts
import { join } from "node:path";
import { safeSegmentSchema } from "./types.js";
import { MeshError } from "./error.js";

function seg(value: string): string {
  const parsed = safeSegmentSchema.safeParse(value);
  if (!parsed.success) throw new MeshError("unsafe_segment", `unsafe path segment: ${value}`);
  return parsed.data;
}

export const meshDir = (storeRoot: string) => join(storeRoot, "mesh");
export const presenceDir = (storeRoot: string) => join(meshDir(storeRoot), "presence");
export const presencePath = (storeRoot: string, liveSessionId: string) =>
  join(presenceDir(storeRoot), `${seg(liveSessionId)}.json`);
export const eventsPath = (storeRoot: string) => join(meshDir(storeRoot), "events.jsonl");
export const claimsDir = (storeRoot: string) => join(meshDir(storeRoot), "claims");
export const claimPath = (storeRoot: string, claimId: string) =>
  join(claimsDir(storeRoot), `${seg(claimId)}.json`);
export const inboxDir = (storeRoot: string, liveSessionId: string) =>
  join(meshDir(storeRoot), "inbox", seg(liveSessionId));
export const quarantineDir = (storeRoot: string) => join(meshDir(storeRoot), "quarantine");
```

`src/atomic-write.ts`: sixth per-package writer, copied discipline from `packages/content-store/src/atomic-write.ts:21` (fsync temp via `r+`, rename, dir-fsync skipped on win32, `mkdirSync {recursive, mode: 0o700}`, file mode `0o600`, refuse symlinked parent) but throwing `MeshError("write_failed", …)`. This repo deliberately keeps one writer per package with its own error posture (see `packages/core/src/json-store.ts:5-12` for the stated split); do not import content-store just for this.

```ts
// packages/mesh/src/quarantine.ts
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { ZodType } from "zod";
import { quarantineDir } from "./paths.js";

export function readJsonOrQuarantine<T>(path: string, schema: ZodType<T>, storeRoot: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // fall through to quarantine
  }
  try {
    const dir = quarantineDir(storeRoot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    renameSync(path, join(dir, `${Date.now()}-${basename(path)}`));
  } catch {
    // fail-open: unreadable AND un-movable → treat as absent
  }
  return undefined;
}
```

Export all from `src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/mesh test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mesh
git commit -m "feat(mesh): store paths, atomic write, quarantine"
```

---

### Task 3: Presence — register, heartbeat, status, listPeers

**Files:**
- Create: `packages/mesh/src/presence.ts`
- Test: `packages/mesh/test/presence.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces:
  - `registerSession(input: { storeRoot: string; record: Omit<PresenceRecord, "registeredAt" | "lastSeenAt">; now?: () => string }): PresenceRecord`
  - `heartbeat(input: { storeRoot: string; liveSessionId: string; patch?: Partial<Pick<PresenceRecord, "status" | "taskLabel" | "branch">>; now?: () => string }): void` — no-op (debounce) when file mtime is younger than `HEARTBEAT_DEBOUNCE_MS` and `patch` is absent; no-op when the session was never registered.
  - `setStatus(input: { storeRoot: string; liveSessionId: string; status: MeshStatus; now?: () => string }): void`
  - `type PeerView = PresenceRecord & { liveness: "live" | "stale" | "dead" }`
  - `listPeers(input: { storeRoot: string; workspaceKey?: string; includeDead?: boolean; nowMs?: number }): PeerView[]` — liveness from `lastSeenAt` vs `STALE_AFTER_MS`/`DEAD_AFTER_MS`; default filters dead out and (when `workspaceKey` given) other workspaces out.

- [ ] **Step 1: Write the failing test**

```ts
// packages/mesh/test/presence.test.ts
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { heartbeat, listPeers, registerSession, setStatus } from "../src/presence.js";
import { presencePath } from "../src/paths.js";

let root: string;
const T0 = "2026-08-06T12:00:00.000+03:00";
const T0_MS = Date.parse(T0);
const base = {
  liveSessionId: "s1", workspaceKey: "0123456789abcdef",
  agent: "claude-code", cwd: "/repo", status: "working" as const,
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "megasaver-mesh-presence-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("presence", () => {
  it("registers, lists, and computes liveness structurally", () => {
    registerSession({ storeRoot: root, record: base, now: () => T0 });
    const live = listPeers({ storeRoot: root, nowMs: T0_MS + 1_000 });
    expect(live).toHaveLength(1);
    expect(live[0]?.liveness).toBe("live");
    const stale = listPeers({ storeRoot: root, nowMs: T0_MS + 120_000 });
    expect(stale[0]?.liveness).toBe("stale");
    const dead = listPeers({ storeRoot: root, nowMs: T0_MS + 700_000 });
    expect(dead).toHaveLength(0);
    expect(listPeers({ storeRoot: root, includeDead: true, nowMs: T0_MS + 700_000 })[0]?.liveness).toBe("dead");
  });
  it("heartbeat refreshes lastSeenAt but debounces young files", () => {
    registerSession({ storeRoot: root, record: base, now: () => T0 });
    // Age the file mtime far past the debounce window, then heartbeat.
    const p = presencePath(root, "s1");
    utimesSync(p, new Date(T0_MS - 60_000), new Date(T0_MS - 60_000));
    heartbeat({ storeRoot: root, liveSessionId: "s1", now: () => "2026-08-06T12:05:00.000+03:00" });
    const [peer] = listPeers({ storeRoot: root, nowMs: Date.parse("2026-08-06T12:05:01.000+03:00") });
    expect(peer?.lastSeenAt).toBe("2026-08-06T12:05:00.000+03:00");
  });
  it("heartbeat without registration is a no-op; setStatus updates status", () => {
    heartbeat({ storeRoot: root, liveSessionId: "ghost" });
    expect(listPeers({ storeRoot: root, includeDead: true })).toHaveLength(0);
    registerSession({ storeRoot: root, record: base, now: () => T0 });
    setStatus({ storeRoot: root, liveSessionId: "s1", status: "blocked", now: () => T0 });
    expect(listPeers({ storeRoot: root, nowMs: T0_MS })[0]?.status).toBe("blocked");
  });
  it("filters by workspaceKey", () => {
    registerSession({ storeRoot: root, record: base, now: () => T0 });
    registerSession({ storeRoot: root, record: { ...base, liveSessionId: "s2", workspaceKey: "fedcba9876543210" }, now: () => T0 });
    expect(listPeers({ storeRoot: root, workspaceKey: "0123456789abcdef", nowMs: T0_MS })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mesh test presence`
Expected: FAIL — `../src/presence.js` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mesh/src/presence.ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { HEARTBEAT_DEBOUNCE_MS, DEAD_AFTER_MS, STALE_AFTER_MS } from "./constants.js";
import { atomicWriteFile } from "./atomic-write.js";
import { presenceDir, presencePath } from "./paths.js";
import { readJsonOrQuarantine } from "./quarantine.js";
import { type MeshStatus, type PresenceRecord, presenceRecordSchema } from "./types.js";

const nowIso = () => new Date().toISOString();

export function registerSession(input: {
  storeRoot: string;
  record: Omit<PresenceRecord, "registeredAt" | "lastSeenAt">;
  now?: () => string;
}): PresenceRecord {
  const at = (input.now ?? nowIso)();
  const record = presenceRecordSchema.parse({ ...input.record, registeredAt: at, lastSeenAt: at });
  atomicWriteFile(presencePath(input.storeRoot, record.liveSessionId), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function heartbeat(input: {
  storeRoot: string; liveSessionId: string;
  patch?: Partial<Pick<PresenceRecord, "status" | "taskLabel" | "branch">>;
  now?: () => string;
}): void {
  const path = presencePath(input.storeRoot, input.liveSessionId);
  if (!existsSync(path)) return;
  if (!input.patch) {
    try {
      if (Date.now() - statSync(path).mtimeMs < HEARTBEAT_DEBOUNCE_MS) return;
    } catch { return; }
  }
  const prior = readJsonOrQuarantine(path, presenceRecordSchema, input.storeRoot);
  if (!prior) return;
  const next: PresenceRecord = { ...prior, ...input.patch, lastSeenAt: (input.now ?? nowIso)() };
  atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

export function setStatus(input: { storeRoot: string; liveSessionId: string; status: MeshStatus; now?: () => string }): void {
  heartbeat({ storeRoot: input.storeRoot, liveSessionId: input.liveSessionId, patch: { status: input.status }, now: input.now });
}

export type PeerView = PresenceRecord & { liveness: "live" | "stale" | "dead" };

export function listPeers(input: {
  storeRoot: string; workspaceKey?: string; includeDead?: boolean; nowMs?: number;
}): PeerView[] {
  const dir = presenceDir(input.storeRoot);
  if (!existsSync(dir)) return [];
  const nowMs = input.nowMs ?? Date.now();
  const peers: PeerView[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const record = readJsonOrQuarantine(
      presencePath(input.storeRoot, file.slice(0, -".json".length)),
      presenceRecordSchema, input.storeRoot,
    );
    if (!record) continue;
    if (input.workspaceKey !== undefined && record.workspaceKey !== input.workspaceKey) continue;
    const age = nowMs - Date.parse(record.lastSeenAt);
    const liveness = age > DEAD_AFTER_MS ? "dead" : age > STALE_AFTER_MS ? "stale" : "live";
    if (liveness === "dead" && input.includeDead !== true) continue;
    peers.push({ ...record, liveness });
  }
  return peers.sort((a, b) => a.liveSessionId.localeCompare(b.liveSessionId));
}
```

Export from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mesh test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mesh
git commit -m "feat(mesh): presence register/heartbeat/listPeers"
```

---

### Task 4: Event log — postEvent, readEvents, rotation

**Files:**
- Create: `packages/mesh/src/events.ts`
- Test: `packages/mesh/test/events.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2; `withFileLock` from `@megasaver/shared/node`.
- Produces:
  - `postEvent(input: { storeRoot: string; event: Omit<MeshEvent, "id" | "at">; now?: () => string; newId?: () => string }): MeshEvent | undefined` — appends one JSON line; rotation before append when file exceeds `EVENTS_MAX_BYTES` or its oldest line is older than `EVENTS_MAX_AGE_MS` (rename to `events-<epochMs>.jsonl`, start fresh; rename, never copy-truncate). Returns `undefined` on any failure (fail-open).
  - `readEvents(input: { storeRoot: string; sinceIso?: string; workspaceKey?: string; limit?: number }): MeshEvent[]` — skips torn/unparsable lines; newest-last; default `limit` 200.

- [ ] **Step 1: Write the failing test**

```ts
// packages/mesh/test/events.test.ts
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postEvent, readEvents } from "../src/events.js";
import { eventsPath } from "../src/paths.js";
import { mkdirSync } from "node:fs";

let root: string;
const T0 = "2026-08-06T12:00:00.000+03:00";
const evt = { kind: "message" as const, liveSessionId: "s1", workspaceKey: "0123456789abcdef", to: "s2", text: "hi" };

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "megasaver-mesh-events-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("event log", () => {
  it("appends and reads back with since/workspace filters", () => {
    postEvent({ storeRoot: root, event: evt, now: () => T0, newId: () => "e1" });
    postEvent({ storeRoot: root, event: { ...evt, text: "later" }, now: () => "2026-08-06T13:00:00.000+03:00", newId: () => "e2" });
    expect(readEvents({ storeRoot: root })).toHaveLength(2);
    expect(readEvents({ storeRoot: root, sinceIso: "2026-08-06T12:30:00.000+03:00" })).toHaveLength(1);
    expect(readEvents({ storeRoot: root, workspaceKey: "ffffffffffffffff" })).toHaveLength(0);
  });
  it("skips torn lines", () => {
    postEvent({ storeRoot: root, event: evt, now: () => T0, newId: () => "e1" });
    appendFileSync(eventsPath(root), '{"torn": tru');
    postEvent({ storeRoot: root, event: evt, now: () => T0, newId: () => "e2" });
    expect(readEvents({ storeRoot: root })).toHaveLength(2);
  });
  it("rotates when the file exceeds the byte cap", () => {
    mkdirSync(dirname(eventsPath(root)), { recursive: true });
    appendFileSync(eventsPath(root), `${JSON.stringify({ pad: "x".repeat(6 * 1024 * 1024) })}\n`);
    postEvent({ storeRoot: root, event: evt, now: () => T0, newId: () => "e1" });
    const files = readdirSync(dirname(eventsPath(root))).filter((f) => f.startsWith("events"));
    expect(files.length).toBe(2);
    expect(readEvents({ storeRoot: root })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mesh test events`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mesh/src/events.ts
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { EVENTS_MAX_AGE_MS, EVENTS_MAX_BYTES } from "./constants.js";
import { eventsPath } from "./paths.js";
import { type MeshEvent, meshEventSchema } from "./types.js";

const nowIso = () => new Date().toISOString();

function maybeRotate(path: string, nowMs: number): void {
  if (!existsSync(path)) return;
  let rotate = false;
  try {
    const stat = statSync(path);
    rotate = stat.size > EVENTS_MAX_BYTES;
    if (!rotate) {
      const firstLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
      const first = meshEventSchema.safeParse(JSON.parse(firstLine));
      rotate = first.success && nowMs - Date.parse(first.data.at) > EVENTS_MAX_AGE_MS;
    }
  } catch {
    rotate = statSync(path).size > EVENTS_MAX_BYTES;
  }
  if (rotate) renameSync(path, path.replace(/\.jsonl$/, `-${nowMs}.jsonl`));
}

export function postEvent(input: {
  storeRoot: string; event: Omit<MeshEvent, "id" | "at">;
  now?: () => string; newId?: () => string;
}): MeshEvent | undefined {
  try {
    const event = meshEventSchema.parse({
      ...input.event,
      id: (input.newId ?? randomUUID)(),
      at: (input.now ?? nowIso)(),
    });
    const path = eventsPath(input.storeRoot);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
      maybeRotate(path, Date.parse(event.at));
      appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    });
    return event;
  } catch {
    return undefined;
  }
}

export function readEvents(input: {
  storeRoot: string; sinceIso?: string; workspaceKey?: string; limit?: number;
}): MeshEvent[] {
  const path = eventsPath(input.storeRoot);
  if (!existsSync(path)) return [];
  const sinceMs = input.sinceIso === undefined ? undefined : Date.parse(input.sinceIso);
  const events: MeshEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = meshEventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) continue;
      if (sinceMs !== undefined && Date.parse(parsed.data.at) < sinceMs) continue;
      if (input.workspaceKey !== undefined && parsed.data.workspaceKey !== input.workspaceKey) continue;
      events.push(parsed.data);
    } catch {
      // torn line — skip
    }
  }
  return events.slice(-(input.limit ?? 200));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mesh test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mesh
git commit -m "feat(mesh): append-only event log with rotation"
```

---

### Task 5: Claims — claim, release, checkConflicts

**Files:**
- Create: `packages/mesh/src/claims.ts`
- Test: `packages/mesh/test/claims.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2; `compileGlob`, `type PathMatcher` from `@megasaver/policy` (see `packages/policy/src/secret-paths.ts`); `withFileLock` from `@megasaver/shared/node`.
- Produces:
  - `claimPaths(input: { storeRoot: string; liveSessionId: string; workspaceKey: string; paths: readonly string[]; intent?: string; now?: () => string; newId?: () => string }): ClaimRecord | undefined` (fail-open undefined)
  - `releaseClaim(input: { storeRoot: string; claimId: string }): void`
  - `releaseSessionClaims(input: { storeRoot: string; liveSessionId: string }): void`
  - `refreshSessionClaims(input: { storeRoot: string; liveSessionId: string; now?: () => string }): void` (bumps `refreshedAt`/`expiresAt` — called from heartbeat piggyback)
  - `listClaims(input: { storeRoot: string; workspaceKey?: string; nowMs?: number }): ClaimRecord[]` (expired filtered out)
  - `type ClaimConflict = { claim: ClaimRecord; matchedPath: string }`
  - `checkConflicts(input: { storeRoot: string; liveSessionId: string; workspaceKey: string; paths: readonly string[]; nowMs?: number }): ClaimConflict[]` — conflicts = unexpired claims by OTHER sessions in the SAME workspace whose stored path/glob matches any input path (repo-relative comparison; glob via `compileGlob`, literal paths compared exactly).

- [ ] **Step 1: Write the failing test**

```ts
// packages/mesh/test/claims.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkConflicts, claimPaths, listClaims, releaseClaim, releaseSessionClaims } from "../src/claims.js";

let root: string;
const T0 = "2026-08-06T12:00:00.000+03:00";
const T0_MS = Date.parse(T0);
const wk = "0123456789abcdef";

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "megasaver-mesh-claims-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("claims", () => {
  it("claims paths and reports conflicts only for other sessions, same workspace", () => {
    const claim = claimPaths({ storeRoot: root, liveSessionId: "s1", workspaceKey: wk, paths: ["src/auth.ts", "src/db/**"], now: () => T0, newId: () => "c1" });
    expect(claim?.claimId).toBe("c1");
    expect(checkConflicts({ storeRoot: root, liveSessionId: "s1", workspaceKey: wk, paths: ["src/auth.ts"], nowMs: T0_MS })).toHaveLength(0);
    const conflicts = checkConflicts({ storeRoot: root, liveSessionId: "s2", workspaceKey: wk, paths: ["src/db/user.ts"], nowMs: T0_MS });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.matchedPath).toBe("src/db/user.ts");
    expect(checkConflicts({ storeRoot: root, liveSessionId: "s2", workspaceKey: "ffffffffffffffff", paths: ["src/auth.ts"], nowMs: T0_MS })).toHaveLength(0);
  });
  it("expires claims after TTL and releases explicitly", () => {
    claimPaths({ storeRoot: root, liveSessionId: "s1", workspaceKey: wk, paths: ["a.ts"], now: () => T0, newId: () => "c1" });
    expect(listClaims({ storeRoot: root, nowMs: T0_MS + 31 * 60_000 })).toHaveLength(0);
    claimPaths({ storeRoot: root, liveSessionId: "s1", workspaceKey: wk, paths: ["b.ts"], now: () => T0, newId: () => "c2" });
    releaseClaim({ storeRoot: root, claimId: "c2" });
    expect(listClaims({ storeRoot: root, nowMs: T0_MS })).toHaveLength(0);
  });
  it("releaseSessionClaims drops only that session's claims", () => {
    claimPaths({ storeRoot: root, liveSessionId: "s1", workspaceKey: wk, paths: ["a.ts"], now: () => T0, newId: () => "c1" });
    claimPaths({ storeRoot: root, liveSessionId: "s2", workspaceKey: wk, paths: ["b.ts"], now: () => T0, newId: () => "c2" });
    releaseSessionClaims({ storeRoot: root, liveSessionId: "s1" });
    const rest = listClaims({ storeRoot: root, nowMs: T0_MS });
    expect(rest).toHaveLength(1);
    expect(rest[0]?.liveSessionId).toBe("s2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mesh test claims`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/claims.ts`: records under `claimsDir`; every write under `` withFileLock(`${claimPath}.lock`, { deadlineMs: 50, staleMs: 5000 }, …) ``; `expiresAt = at + CLAIM_TTL_MS`. Conflict matching: a stored path containing `*`/`?`/`[` compiles once per check via `compileGlob` from `@megasaver/policy`; otherwise exact string equality on normalized repo-relative paths (`path.replaceAll("\\", "/")`). Skeleton:

```ts
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { withFileLock } from "@megasaver/shared/node";
import { compileGlob } from "@megasaver/policy";
import { CLAIM_TTL_MS } from "./constants.js";
import { atomicWriteFile } from "./atomic-write.js";
import { claimPath, claimsDir } from "./paths.js";
import { readJsonOrQuarantine } from "./quarantine.js";
import { type ClaimRecord, claimRecordSchema } from "./types.js";

const nowIso = () => new Date().toISOString();
const isGlob = (p: string) => /[*?[]/.test(p);
const norm = (p: string) => p.replaceAll("\\", "/");

export function claimPaths(input: {
  storeRoot: string; liveSessionId: string; workspaceKey: string;
  paths: readonly string[]; intent?: string; now?: () => string; newId?: () => string;
}): ClaimRecord | undefined {
  try {
    const at = (input.now ?? nowIso)();
    const record = claimRecordSchema.parse({
      claimId: (input.newId ?? randomUUID)(),
      liveSessionId: input.liveSessionId, workspaceKey: input.workspaceKey,
      paths: input.paths.map(norm), intent: input.intent,
      createdAt: at, refreshedAt: at,
      expiresAt: new Date(Date.parse(at) + CLAIM_TTL_MS).toISOString(),
    });
    const path = claimPath(input.storeRoot, record.claimId);
    withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
      atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`);
    });
    return record;
  } catch {
    return undefined;
  }
}

export function listClaims(input: { storeRoot: string; workspaceKey?: string; nowMs?: number }): ClaimRecord[] {
  const dir = claimsDir(input.storeRoot);
  if (!existsSync(dir)) return [];
  const nowMs = input.nowMs ?? Date.now();
  const claims: ClaimRecord[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const record = readJsonOrQuarantine(claimPath(input.storeRoot, file.slice(0, -5)), claimRecordSchema, input.storeRoot);
    if (!record) continue;
    if (Date.parse(record.expiresAt) <= nowMs) continue;
    if (input.workspaceKey !== undefined && record.workspaceKey !== input.workspaceKey) continue;
    claims.push(record);
  }
  return claims;
}

export type ClaimConflict = { claim: ClaimRecord; matchedPath: string };

export function checkConflicts(input: {
  storeRoot: string; liveSessionId: string; workspaceKey: string;
  paths: readonly string[]; nowMs?: number;
}): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  for (const claim of listClaims({ storeRoot: input.storeRoot, workspaceKey: input.workspaceKey, nowMs: input.nowMs })) {
    if (claim.liveSessionId === input.liveSessionId) continue;
    for (const stored of claim.paths) {
      const matcher = isGlob(stored) ? compileGlob(stored) : null;
      for (const candidate of input.paths.map(norm)) {
        if (matcher ? matcher(candidate) : candidate === stored) {
          conflicts.push({ claim, matchedPath: candidate });
        }
      }
    }
  }
  return conflicts;
}

export function releaseClaim(input: { storeRoot: string; claimId: string }): void {
  try { rmSync(claimPath(input.storeRoot, input.claimId), { force: true }); } catch { /* fail-open */ }
}

export function releaseSessionClaims(input: { storeRoot: string; liveSessionId: string }): void {
  for (const claim of listClaims({ storeRoot: input.storeRoot, nowMs: 0 })) {
    if (claim.liveSessionId === input.liveSessionId) releaseClaim({ storeRoot: input.storeRoot, claimId: claim.claimId });
  }
}

export function refreshSessionClaims(input: { storeRoot: string; liveSessionId: string; now?: () => string }): void {
  const at = (input.now ?? nowIso)();
  for (const claim of listClaims({ storeRoot: input.storeRoot })) {
    if (claim.liveSessionId !== input.liveSessionId) continue;
    const path = claimPath(input.storeRoot, claim.claimId);
    const next: ClaimRecord = { ...claim, refreshedAt: at, expiresAt: new Date(Date.parse(at) + CLAIM_TTL_MS).toISOString() };
    withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
      atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
    });
  }
}
```

NOTE for implementer: `listClaims({ nowMs: 0 })` inside `releaseSessionClaims` deliberately treats nothing as expired (epoch 0 predates all `expiresAt`) so even just-expired claims get deleted. If `compileGlob`'s exported signature differs (check `packages/policy/src/secret-paths.ts` — it exports `compileGlob` and `type PathMatcher`), adapt the two call sites in this file only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mesh test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mesh
git commit -m "feat(mesh): advisory path claims with TTL"
```

---

### Task 6: Messages — sendMessage, drainInbox

**Files:**
- Create: `packages/mesh/src/messages.ts`
- Test: `packages/mesh/test/messages.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4; `redact` from `@megasaver/policy` (`packages/policy/src/redact.ts:44` — `redact(text: string): { redacted: string; count: number }`).
- Produces:
  - `sendMessage(input: { storeRoot: string; from: string; to: string; kind: "message" | "ask" | "answer"; text: string; provenance?: string; now?: () => string; newId?: () => string }): MeshMessage | undefined` — redacts `text`, writes `inbox/<to>/<id>.json`, posts a bus event (same `kind`). Fail-open `undefined`.
  - `drainInbox(input: { storeRoot: string; liveSessionId: string; maxMessages?: number }): MeshMessage[]` — atomically claims up to `DRAIN_MAX_MESSAGES` files by `rename` into a per-call temp dir before reading (two concurrent drains never deliver the same message twice), oldest-first by file mtime.

- [ ] **Step 1: Write the failing test**

```ts
// packages/mesh/test/messages.test.ts
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainInbox, sendMessage } from "../src/messages.js";
import { readEvents } from "../src/events.js";
import { inboxDir } from "../src/paths.js";

let root: string;
const T0 = "2026-08-06T12:00:00.000+03:00";

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "megasaver-mesh-msg-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("messages", () => {
  it("delivers to the inbox, redacts secrets, and posts a bus event", () => {
    const msg = sendMessage({
      storeRoot: root, from: "s1", to: "s2", kind: "message",
      text: "token is sk-ant-api03-abcdefghijklmnopqrstuvwx-more", now: () => T0, newId: () => "m1",
    });
    expect(msg?.text).not.toContain("sk-ant-");
    const drained = drainInbox({ storeRoot: root, liveSessionId: "s2" });
    expect(drained).toHaveLength(1);
    expect(drained[0]?.id).toBe("m1");
    expect(readEvents({ storeRoot: root }).some((e) => e.kind === "message")).toBe(true);
  });
  it("drain is at-most-once and caps the batch", () => {
    for (let i = 0; i < 7; i += 1) {
      sendMessage({ storeRoot: root, from: "s1", to: "s2", kind: "message", text: `m${i}`, now: () => T0, newId: () => `m${i}` });
    }
    const first = drainInbox({ storeRoot: root, liveSessionId: "s2" });
    const second = drainInbox({ storeRoot: root, liveSessionId: "s2" });
    expect(first).toHaveLength(5);
    expect(second).toHaveLength(2);
    const ids = new Set([...first, ...second].map((m) => m.id));
    expect(ids.size).toBe(7);
    expect(readdirSync(inboxDir(root, "s2"))).toHaveLength(0);
  });
  it("draining an empty or absent inbox returns []", () => {
    expect(drainInbox({ storeRoot: root, liveSessionId: "nobody" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mesh test messages`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/mesh/src/messages.ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { redact } from "@megasaver/policy";
import { DRAIN_MAX_MESSAGES } from "./constants.js";
import { atomicWriteFile } from "./atomic-write.js";
import { postEvent } from "./events.js";
import { inboxDir } from "./paths.js";
import { readJsonOrQuarantine } from "./quarantine.js";
import { type MeshMessage, meshMessageSchema } from "./types.js";

const nowIso = () => new Date().toISOString();

export function sendMessage(input: {
  storeRoot: string; from: string; to: string;
  kind: "message" | "ask" | "answer"; text: string; provenance?: string;
  now?: () => string; newId?: () => string;
}): MeshMessage | undefined {
  try {
    const message = meshMessageSchema.parse({
      id: (input.newId ?? randomUUID)(), from: input.from, to: input.to,
      kind: input.kind, text: redact(input.text).redacted,
      at: (input.now ?? nowIso)(), provenance: input.provenance,
    });
    const dir = inboxDir(input.storeRoot, input.to);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWriteFile(join(dir, `${message.id}.json`), `${JSON.stringify(message, null, 2)}\n`);
    postEvent({
      storeRoot: input.storeRoot,
      event: { kind: input.kind, liveSessionId: input.from, workspaceKey: "0000000000000000", to: input.to, text: message.text },
      now: input.now, newId: input.newId,
    });
    return message;
  } catch {
    return undefined;
  }
}

export function drainInbox(input: { storeRoot: string; liveSessionId: string; maxMessages?: number }): MeshMessage[] {
  const dir = inboxDir(input.storeRoot, input.liveSessionId);
  if (!existsSync(dir)) return [];
  const cap = input.maxMessages ?? DRAIN_MAX_MESSAGES;
  const claimed = join(dir, `.drain-${process.pid}-${Date.now()}`);
  const out: MeshMessage[] = [];
  try {
    mkdirSync(claimed, { recursive: true, mode: 0o700 });
    const candidates = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
      .slice(0, cap);
    for (const { f } of candidates) {
      try {
        renameSync(join(dir, f), join(claimed, f));   // atomic claim: loser's rename throws ENOENT
      } catch { continue; }
      const msg = readJsonOrQuarantine(join(claimed, f), meshMessageSchema, input.storeRoot);
      if (msg) out.push(msg);
    }
  } catch {
    // fail-open
  } finally {
    rmSync(claimed, { recursive: true, force: true });
  }
  return out;
}
```

NOTE for implementer: the `workspaceKey: "0000000000000000"` placeholder in the bus event is wrong by design pressure — fix it properly by threading the sender's real `workspaceKey` into `sendMessage`'s input (add `workspaceKey: string` to the input type, the schema already requires it) and update the test to pass `workspaceKey: "0123456789abcdef"`. Do NOT ship the placeholder; this note exists so the diff-reviewer checks it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mesh test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mesh
git commit -m "feat(mesh): inbox messages with at-most-once drain"
```

---

### Task 7: GC

**Files:**
- Create: `packages/mesh/src/gc.ts`
- Test: `packages/mesh/test/gc.test.ts`

**Interfaces:**
- Consumes: Tasks 2-6.
- Produces: `gc(input: { storeRoot: string; nowMs?: number }): { deadPresence: number; expiredClaims: number; droppedInboxes: number; rotatedLogs: number }` — removes presence files with `lastSeenAt` older than `DEAD_AFTER_MS`, claim files past `expiresAt`, inbox dirs whose session presence is gone, and rotated `events-*.jsonl` older than `EVENTS_MAX_AGE_MS`. Also `maybeGc(input: { storeRoot: string }): void` — probabilistic trigger (`Math.random() < 0.02`) with a cheap marker-file mtime check (`mesh/.last-gc`, skip if younger than 10 min) so hook piggybacks stay sub-ms in the common case.

- [ ] **Step 1: Write the failing test** — seed one dead presence (lastSeenAt = T0), one live presence, one expired claim, one orphan inbox dir, one old rotated log; call `gc({ storeRoot: root, nowMs: T0_MS + 8 * 24 * 3600 * 1000 })`; assert counts `{ deadPresence: 1, expiredClaims: 1, droppedInboxes: 1, rotatedLogs: 1 }` and the live presence survives. (Write the seed with the Task 3/5/6 public APIs plus `utimesSync` for the rotated log; follow the exact style of the Task 5 test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mesh test gc`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `gc.ts` with the four sweeps (each in its own try/catch so one failure never aborts the rest; `rmSync(..., { force: true })`), plus `maybeGc` writing the marker via `atomicWriteFile`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mesh test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mesh
git commit -m "feat(mesh): gc for presence, claims, inboxes, logs"
```

---

### Task 8: CLI — `mega mesh` command group

**Files:**
- Create: `apps/cli/src/commands/mesh/index.ts`, `apps/cli/src/commands/mesh/status.ts`, `apps/cli/src/commands/mesh/send.ts`, `apps/cli/src/commands/mesh/claims.ts`, `apps/cli/src/commands/mesh/events.ts`, `apps/cli/src/commands/mesh/gc.ts`
- Modify: `apps/cli/src/main.ts` (add `mesh` to `subCommands`), `apps/cli/package.json` (add `"@megasaver/mesh": "workspace:*"`)
- Test: `apps/cli/test/commands/mesh/status.test.ts`, `apps/cli/test/commands/mesh/send.test.ts`

**Interfaces:**
- Consumes: `@megasaver/mesh` public API; `resolveStorePath`/`readStoreEnv` from `apps/cli/src/store.ts`; the cli-test-pattern (`wiki/workflows/cli-test-pattern.md` — nested test dirs are current practice, flat-layout rule is obsolete).
- Produces (for tests and later tasks): `runMeshStatus(input: RunMeshStatusInput): Promise<0 | 1>` where

```ts
export type RunMeshStatusInput = {
  storeFlag: string | undefined;
  all: boolean; json: boolean;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void;
  nowMs?: number;
};
```

and `runMeshSend(input: { storeFlag: string | undefined; to: string; text: string; kind: "message" | "ask"; from: string | undefined; cwd: string; home: string; xdgDataHome: string | undefined; platform: NodeJS.Platform; localAppData: string | undefined; stdout: (line: string) => void; stderr: (line: string) => void; json: boolean }): Promise<0 | 1>`.

- [ ] **Step 1: Write the failing tests** — per cli-test-pattern: temp store via `mkdtempSync(join(tmpdir(), "megasaver-mesh-cli-"))`, seed peers/messages with `@megasaver/mesh` APIs directly, call `runMeshStatus` with injected `stdout` collector, assert the table contains the seeded session id, `--json` emits parseable JSON with `liveness` fields; `runMeshSend` with a missing `--from` and no registered self resolves `from` to `"cli"` and exits 0; unknown `to` still delivers (inbox is created on demand). Status test for a workspace-filtered default: seed two workspaces, assert only the matching one prints without `all: true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test mesh`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — group index mirrors `apps/cli/src/commands/hooks/index.ts` (defineCommand + subCommands + re-export `runX` for tests). `status.ts` renders a fixed-width table (session, agent, status, liveness, task, age); `send.ts` derives `workspaceKey` via `encodeWorkspaceKey(cwd)` from `@megasaver/shared`; `events.ts` supports `--since` and `--follow` (2 s `setInterval` polling `readEvents`; `--follow` exits on SIGINT only — no daemon dependency in this task); `gc.ts` calls `gc()` and prints counts. Register `mesh` in `main.ts` `subCommands`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test mesh && pnpm --filter @megasaver/cli typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli packages/mesh pnpm-lock.yaml
git commit -m "feat(cli): mega mesh status/send/claims/events/gc"
```

---

### Task 9: Hook piggybacks (register / heartbeat / conflict+drain)

**Files:**
- Modify: `apps/cli/src/hooks/warmup-run.ts` (register), `apps/cli/src/hooks/saver-run.ts` (heartbeat + claim refresh), `apps/cli/src/hooks/guard-run.ts` (checkConflicts + drainInbox → additionalContext)
- Test: `apps/cli/test/hooks/mesh-piggyback.test.ts`

**Interfaces:**
- Consumes: `registerSession`, `heartbeat`, `refreshSessionClaims`, `checkConflicts`, `drainInbox` from `@megasaver/mesh`; existing hook payload parsing in each handler (session_id, cwd, tool_input.file_path).
- Produces: `formatMeshAdditionalContext(input: { conflicts: ClaimConflict[]; messages: MeshMessage[] }): string | undefined` (new export in `apps/cli/src/hooks/mesh-context.ts`) — labels peer text as untrusted data, caps at `DRAIN_MAX_TOKENS` estimated via `Math.ceil(chars / 4)`.

- [ ] **Step 1: Write the failing test** — three cases, each driving the existing `runXFromProcess` with a stdin-payload fixture per the existing tests in `apps/cli/test/hooks/` (mimic their stdin-injection mechanism exactly as found — e.g. how `install.test.ts` and the saver tests feed payloads):
  1. warmup payload with `session_id`/`cwd` → presence file exists after run, `agent: "claude-code"`.
  2. guard payload (`tool_name: "Edit"`, `tool_input.file_path` inside a claimed path, claim by another session, same workspace) → stdout JSON contains `additionalContext` with the claimant session id AND the string `"untrusted"`; a pending inbox message is ALSO included; a second run returns no message (drained).
  3. mesh store dir chmod'd unreadable → all three handlers still exit 0 and their primary output is unchanged (fail-open).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test mesh-piggyback`
Expected: FAIL — no mesh calls wired yet.

- [ ] **Step 3: Implement** — in each handler add a single late `try { … } catch { /* mesh is best-effort */ }` block AFTER the handler's primary output decision is complete: warmup → `registerSession` (agent `"claude-code"`, `taskLabel` from `readSessionIntent` when present); saver → `heartbeat` + `refreshSessionClaims` (both sync, after the decision is rendered — never on the awaited path); guard → conflicts + drain merged into the guard's existing additionalContext channel via `formatMeshAdditionalContext`. HOT-PATH GUARD: add an assertion test (mimic the no-eager-typescript-load guard referenced by decisions/lazy-load-heavy-deps) proving `@megasaver/mesh` is imported lazily (`await import`) inside the try block, so hook cold-start cost is unchanged when the mesh dir is absent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test hooks`
Expected: PASS, including all pre-existing hook tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): mesh piggybacks in warmup/saver/guard hooks"
```

---

### Task 10: MCP bridge tools

**Files:**
- Create: `packages/mcp-bridge/src/tools/mesh.ts`
- Modify: `packages/mcp-bridge/src/tool-name.ts` (extend `mcpToolNameSchema` enum — alphabetic order), `packages/mcp-bridge/src/tool-schemas.ts` (`TOOL_INPUT_SCHEMAS` entries), `packages/mcp-bridge/src/server.ts` (`TOOL_DEFS` + `dispatch` cases), `packages/mcp-bridge/package.json` (add `@megasaver/mesh`)
- Test: `packages/mcp-bridge/test/mesh-tools.test.ts`

**Interfaces:**
- Consumes: `@megasaver/mesh` API; the 4-file registration pattern (`packages/mcp-bridge/src/server.ts:136` `TOOL_DEFS`, `dispatch` switch, `PUBLISHED_INPUT_SCHEMAS` built from `TOOL_INPUT_SCHEMAS` with `zodToJsonSchema {$refStrategy:"none"}`).
- Produces: 7 tools — `mesh_claim`, `mesh_events`, `mesh_peers`, `mesh_poll`, `mesh_release`, `mesh_send`, `mesh_status_set` (alphabetic). Handler module exports, one per tool, following the house shape (`packages/mcp-bridge/src/tools/get-relevant-memories.ts` pattern):

```ts
export type MeshToolsEnv = { storeRoot: string; liveSessionId?: string; now?: () => string; newId?: () => string };
export const meshPeersInputSchema = z.object({ workspaceKey: z.string().regex(/^[0-9a-f]{16}$/).optional(), includeDead: z.boolean().optional() }).strict();
export async function handleMeshPeers(env: MeshToolsEnv, args: unknown): Promise<{ peers: PeerView[] }>
// … mesh_send { to, text, kind? } → { delivered: boolean; id?: string }
// … mesh_poll {} → { messages: MeshMessage[] }   (drains the CALLER's inbox — requires env.liveSessionId; error code "no_session" otherwise)
// … mesh_claim { paths: string[]; intent?: string } → { claimId?: string; conflicts: ClaimConflict[] }
// … mesh_release { claimId } → { released: true }
// … mesh_events { sinceIso?, limit? } → { events: MeshEvent[] }
// … mesh_status_set { status } → { ok: true }
```

Errors via `McpBridgeError` like every other tool.

- [ ] **Step 1: Write the failing test** — temp store; call each handler directly (house test style for tools): peers empty → seed via `@megasaver/mesh` → peers returns 1; send→poll round-trip delivers and second poll is empty; claim with a conflicting existing claim returns the conflict AND still creates the claim (advisory model); `mesh_poll` without `env.liveSessionId` throws `McpBridgeError` with code `"no_session"`; `mesh_events` respects `limit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test mesh`
Expected: FAIL.

- [ ] **Step 3: Implement** the handler module + the 4-file registration edits. Where `dispatch` builds the env: thread `deps.storeRoot` and (if the server already knows a live session id — check how existing session-scoped tools resolve it; if none exists) leave `liveSessionId` undefined and document that `mesh_poll`/`mesh_status_set` need the caller to have registered via CLI/hooks; `mesh_send` takes explicit `from` in that case — add optional `from` to its schema, falling back to `env.liveSessionId`, error `"no_session"` when both absent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/mcp-bridge test && pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: PASS, including the existing tool-name/schema-coverage tests (they will fail loudly if any of the 4 files is missing an entry — that is the pattern working).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge pnpm-lock.yaml
git commit -m "feat(mcp): seven mesh tools on the bridge"
```

---

### Task 11: Daemon route GET /mesh/status

**Files:**
- Modify: `packages/daemon/src/server.ts` (route), `packages/daemon/src/handlers.ts` (handler), `packages/daemon/package.json` (add `@megasaver/mesh`)
- Modify: `apps/cli/src/commands/mesh/status.ts` (`--follow` prefers a RUNNING daemon via `getRunningDaemon` — never spawns; falls back to direct file polling)
- Test: `packages/daemon/test/mesh-status.test.ts`

**Interfaces:**
- Consumes: `startDaemonServer` test harness style from existing daemon tests; `listPeers`, `listClaims` from `@megasaver/mesh`; `getRunningDaemon` from `@megasaver/daemon` (client, never spawns).
- Produces: `handleMeshStatus(deps: { storeRoot: string }): HandlerResponse` returning `{ peers: PeerView[]; claims: ClaimRecord[] }`; route `GET /mesh/status` (Bearer-auth like every route).

- [ ] **Step 1: Write the failing test** — start a daemon on a temp store (mimic an existing `packages/daemon/test/*.test.ts` server test's start/close lifecycle), seed one presence + one claim, `fetch` the route with the token → 200 + one peer + one claim; without token → 401.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon test mesh`
Expected: FAIL — 404 route.

- [ ] **Step 3: Implement** route + handler (read-on-request; no fs.watch), and the CLI `--follow` daemon preference (poll `GET /mesh/status` at 2 s when `getRunningDaemon` returns a handle; identical rendering either way).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/daemon test && pnpm --filter @megasaver/cli test mesh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon apps/cli pnpm-lock.yaml
git commit -m "feat(daemon): mesh status route for live view"
```

---

### Task 12: E2E, changeset, wiki, verify

**Files:**
- Create: `apps/cli/test/e2e/mesh-two-sessions.test.ts`, `.changeset/session-mesh.md`, `wiki/entities/mesh.md`
- Modify: `wiki/index.md` (entity link), `wiki/log.md` (entry)

**Interfaces:**
- Consumes: everything above.
- Produces: shipped evidence for DoD items 4-5.

- [ ] **Step 1: Write the E2E test** — one temp store, simulate two sessions end-to-end through PUBLIC surfaces only (hook payload fixtures + `runMesh*` handlers, no direct internal calls): register s1+s2 (warmup payloads) → s1 claims `src/**` (mesh_claim handler) → s2 guard payload editing `src/x.ts` gets conflict warning naming s1 → s1 sends ask, s2's guard fire drains it → s2 answers → s1 poll receives answer with provenance → `runMeshStatus` table shows both sessions → gc after simulated death removes s1. Assert each step on observable outputs (stdout JSON, files), not internals.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @megasaver/cli test e2e/mesh`
Expected: PASS.

- [ ] **Step 3: Changeset + wiki**

`.changeset/session-mesh.md`:

```md
---
"@megasaver/mesh": minor
"@megasaver/cli": minor
"@megasaver/mcp-bridge": minor
"@megasaver/daemon": minor
---

Session Mesh v1: cross-terminal session presence, messaging, advisory
file claims with conflict warnings, mega mesh CLI, 7 MCP tools, daemon
/mesh/status route. Files are the source of truth; every hook-side
call is fail-open.
```

`wiki/entities/mesh.md` per wiki/CLAUDE.md page format (frontmatter, ≤50 lines, cite the spec); link from `wiki/index.md` entities section; append `wiki/log.md` entry.

- [ ] **Step 4: Full verify**

Run: `pnpm verify`
Expected: green (biome + tsc + all suites). Fix anything red before proceeding.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/e2e .changeset wiki
git commit -m "test(mesh): two-session e2e + changeset + wiki"
```

---

## Self-Review (author pass — done at plan-writing time)

- Spec coverage: presence/bus/claims/inbox (§Components 1) → Tasks 3-6; hook piggybacks (§2) → Task 9; MCP tools (§3) → Task 10; CLI (§4) → Task 8; daemon (§5) → Task 11; GC/error/quarantine → Tasks 2, 7; testing section → per-task tests + Task 12 e2e.
- Known deliberate deviations from the spec's earlier draft: no new settings.json hooks (spec was amended to match); daemon route instead of fs.watch (spec amended); `mesh_ask` folded into `mesh_send {kind:"ask"}` — 7 tools not 8; Stop-hook done-status deferred (spec §Non-goals).
- Open items the implementer must resolve (marked inline): `sendMessage` workspaceKey threading (Task 6 NOTE), `compileGlob` signature check (Task 5 NOTE), MCP session-identity resolution (Task 10 Step 3), stdin-fixture mechanism copied from existing hook tests (Task 9 Step 1).
- HIGH-risk chain reminder: worktree `feat/session-mesh`, architect pass before implementation starts, code-reviewer AND critic on the result, verifier evidence per §9.
