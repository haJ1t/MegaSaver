# Session Resurrection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega resume <sessionId>` / `mega resume --last` rebuilds a dead session's working context into a bounded, redacted, evidence-pointer kickoff capsule, emitted to stdout/clipboard or delivered at-most-once to the next session through the existing task-kickoff seam.

**Architecture:** A read-only gather layer resolves a session in either store layout (registry `content/<projectId>/<sessionId>/`, overlay `content/<workspaceKey>/<liveSessionId>/`), joins the diff-on-reread read-index to chunk-set summaries, and classifies liveness (mesh presence when available). A deterministic renderer produces the capsule under the task-kickoff caps. Mode `--next` persists one pending capsule per workspace which `prepareTaskKickoff` consumes by atomic rename and ships through its unchanged claim/pack/envelope/event pipeline.

**Tech Stack:** TypeScript strict ESM, citty, Zod, Vitest, node:fs/node:crypto; packages `@megasaver/content-store`, `@megasaver/core`, `@megasaver/context-gate`, `@megasaver/output-filter`, `@megasaver/policy`, `@megasaver/shared`.

## Global Constraints

- Capsule budget: ≤ `TASK_KICKOFF_TOKEN_CAP` (2 000) tokens AND ≤ `TASK_KICKOFF_CHARACTER_CAP` (9 000) UTF-16 units — constants imported from `apps/cli/src/hooks/task-kickoff-pack.ts`, never redefined.
- Every emitted or persisted capsule text is a `redact()` fixed point (`@megasaver/policy`).
- Gathering is fail-open: each unavailable source becomes a labeled omission string, never an exception.
- Live refusal (exit 1) only on fresh mesh presence (`lastSeenAt` < `RESUME_LIVE_WINDOW_MS` = 10 min, matching mesh `DEAD_AFTER_MS` = 600 000 ms). Mesh presence is keyed by liveSessionId, so the gate applies to overlay targets only — registry session ids have no liveSessionId mapping and always take the heuristic path. Recent activity without mesh presence only warns on stderr and proceeds.
- `--next` delivery is at-most-once: rename-claim consume + the existing task-kickoff session tombstone; a pending capsule older than `RESUME_CAPSULE_MAX_AGE_MS` (24 h) is discarded on consume.
- `--next` refuses (exit 1) on `win32` (task-kickoff persistence is POSIX-only, amendment 2026-08-01 §5) and when no registered project matches the cwd (capsule key parity: `encodeWorkspaceKey(project.rootPath)`).
- apps/cli reads stats ONLY via `@megasaver/core` re-exports (`apps/cli/test/dependency-graph.test.ts` §3c allow-list).
- Regression gate: with no pending capsule present, `prepareTaskKickoff` behavior is byte-identical to today.
- Session-mesh is a soft dependency; the presence reader is tolerant and fail-open. Contract (locked by the session-mesh plan's `presenceRecordSchema`, `docs/superpowers/plans/2026-08-06-session-mesh.md` Task 1): `store/mesh/presence/<liveSessionId>.json` carries an ISO-offset `lastSeenAt` field.
- `listOverlayChunkSets` on `@megasaver/content-store` is OWNED by the compaction-guard plan (build-order 2 of 11, its Task 1); this plan consumes the delivered export and never defines it (Task 1 guard below).
- No timing-tight tests: hook tests pass explicit deadlines ≥ 5 000 ms and assert structure, never durations.
- Conventional commits (§10), imperative subject ≤ 50 chars; one logical change per commit.

---

### Task 1: consume `listOverlayChunkSets` (delivered by compaction-guard)

> **Cross-pair ownership:** `listOverlayChunkSets` is OWNED by the
> compaction-guard pair (build-order 2 of 11; its Task 1,
> `docs/superpowers/plans/2026-08-06-compaction-guard.md`), which implements it
> together with the reserved-sibling skips — `READ_INDEX_FILENAME`,
> `SHOWN_INDEX_FILENAME`, and its `CAPSULE_FILENAME` (`work-state-capsule.json`).
> This plan consumes the delivered export and does NOT define it: a second
> definition here would drop the `CAPSULE_FILENAME` skip and make gather throw
> `ContentStoreError("store_corrupt")` on any overlay session dir holding a
> compaction capsule.

**Files:** none (dependency check only).

**Interfaces (Consumes):**

```ts
// From @megasaver/content-store — implemented by compaction-guard Task 1.
export async function listOverlayChunkSets(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
}): Promise<readonly ChunkSetSummary[]>;
```

- [ ] Guard: skip this task if `listOverlayChunkSets` is already exported from `@megasaver/content-store` (the normal case — compaction-guard builds earlier).
- [ ] Out-of-order fallback ONLY (export absent): execute the compaction-guard plan's Task 1 verbatim — its test file `packages/content-store/test/overlay-list.test.ts`, its implementation including the `CAPSULE_FILENAME` skip, its `packages/content-store/src/index.ts` exports, and its commit message. Never write a local variant.

---

### Task 2: `readOverlaySummary` re-export in core

**Files:**
- `packages/core/src/context-gate.ts` (extend existing `@megasaver/stats` re-export block, which already carries `readOverlayEvents` and `readOverlaySummaryAnyWorkspace`)
- `packages/core/test/overlay-summary-reexport.test.ts` (new)

**Interfaces:** re-export only — `readOverlaySummary(store: StatsStore, workspaceKey: string, liveSessionId: string): OverlaySessionTokenSaverStats | null` (defined at `packages/stats/src/store.ts:527`).

- [ ] Write failing test `packages/core/test/overlay-summary-reexport.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOverlaySummary } from "../src/index.js";

const WK = "0123456789abcdef";
const LSID = "22222222-2222-4222-8222-222222222222";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "core-overlay-summary-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readOverlaySummary re-export", () => {
  it("reads a valid overlay summary through the core surface", () => {
    const dir = join(root, "stats", WK);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${LSID}.json`),
      JSON.stringify({
        liveSessionId: LSID,
        eventsTotal: 3,
        rawBytesTotal: 3000,
        returnedBytesTotal: 600,
        bytesSavedTotal: 2400,
        savingRatio: 0.8,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 3,
        updatedAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    const summary = readOverlaySummary({ root }, WK, LSID);
    expect(summary?.liveSessionId).toBe(LSID);
    expect(summary?.eventsTotal).toBe(3);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/core test -- test/overlay-summary-reexport.test.ts` — expect FAIL: no export named `readOverlaySummary`.
- [ ] Implement: add `readOverlaySummary,` to the existing `export { ... } from "@megasaver/stats";` block in `packages/core/src/context-gate.ts` (the one exporting `readOverlayEvents` / `readOverlaySummaryAnyWorkspace`).
- [ ] Run the test — expect PASS. Run `pnpm --filter @megasaver/core test` — package green.
- [ ] Commit: `feat(core): re-export readOverlaySummary`

---

### Task 3: pending resume-capsule store

**Files:**
- `apps/cli/src/hooks/resume-capsule.ts` (new)
- `apps/cli/test/hooks/resume-capsule.test.ts` (new)

**Interfaces:**

```ts
export const RESUME_CAPSULE_FILENAME = "resume-capsule.json";
export const RESUME_CAPSULE_MAX_AGE_MS = 24 * 60 * 60_000;

export type ResumeCapsule = {
  version: 1;
  sourceSessionId: string;
  text: string;       // ≤ TASK_KICKOFF_CHARACTER_CAP
  tokenCount: number; // ≤ TASK_KICKOFF_TOKEN_CAP
  createdAt: number;  // epoch ms
};

export function resumeCapsulePath(storeRoot: string, workspaceKey: string): string;
export function writeResumeCapsule(
  storeRoot: string,
  workspaceKey: string,
  capsule: ResumeCapsule,
): void; // throws on failure (command surfaces the error)
export function consumeResumeCapsule(
  storeRoot: string,
  workspaceKey: string,
  claimingSessionId: string,
  now?: () => number,
): ResumeCapsule | null; // NEVER throws (hook-side consumer)
```

- [ ] Write failing test `apps/cli/test/hooks/resume-capsule.test.ts` (harness style: `apps/cli/test/hooks/task-kickoff-store.test.ts`):

```ts
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ResumeCapsule,
  RESUME_CAPSULE_MAX_AGE_MS,
  consumeResumeCapsule,
  resumeCapsulePath,
  writeResumeCapsule,
} from "../../src/hooks/resume-capsule.js";

const WK = "1a2b3c4d5e6f7a8b";
const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-resume-capsule-"));
  roots.push(root);
  return root;
}

function capsule(overrides: Partial<ResumeCapsule> = {}): ResumeCapsule {
  return {
    version: 1,
    sourceSessionId: "dead-session-1",
    text: "# Session resurrection — demo\npointer body\n",
    tokenCount: 12,
    createdAt: NOW - 60_000,
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resume capsule store", () => {
  it("round-trips write then consume; second consume returns null", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(true);

    const consumed = consumeResumeCapsule(root, WK, "next-session-1", () => NOW);
    expect(consumed?.sourceSessionId).toBe("dead-session-1");
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(false);
    expect(consumeResumeCapsule(root, WK, "next-session-2", () => NOW)).toBeNull();
  });

  it("discards a capsule older than RESUME_CAPSULE_MAX_AGE_MS", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule({ createdAt: NOW - RESUME_CAPSULE_MAX_AGE_MS - 1 }));
    expect(consumeResumeCapsule(root, WK, "next-session-1", () => NOW)).toBeNull();
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(false);
  });

  it("discards a malformed capsule file and returns null", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    writeFileSync(resumeCapsulePath(root, WK), "{not json");
    expect(consumeResumeCapsule(root, WK, "next-session-1", () => NOW)).toBeNull();
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(false);
  });

  it("returns null without creating files when nothing is pending", () => {
    const root = createRoot();
    expect(consumeResumeCapsule(root, WK, "next-session-1", () => NOW)).toBeNull();
  });

  it("rejects an unsafe claiming session id without touching the capsule", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    expect(consumeResumeCapsule(root, WK, "../evil", () => NOW)).toBeNull();
    expect(existsSync(resumeCapsulePath(root, WK))).toBe(true);
  });

  it("leaves no stray tmp files behind after a consume", () => {
    const root = createRoot();
    writeResumeCapsule(root, WK, capsule());
    consumeResumeCapsule(root, WK, "next-session-1", () => NOW);
    expect(readdirSync(dirname(resumeCapsulePath(root, WK)))).not.toContainEqual(
      expect.stringContaining(".tmp"),
    );
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli test -- test/hooks/resume-capsule.test.ts` — expect FAIL: module `../../src/hooks/resume-capsule.js` not found.
- [ ] Implement `apps/cli/src/hooks/resume-capsule.ts` (atomic-write discipline mirrors `writeIntentAt`, `apps/cli/src/hooks/intent-run.ts:102`; safe-segment check reuses `isSafeHookSessionId`, `apps/cli/src/hooks/task-kickoff-store.ts:54`):

```ts
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { TASK_KICKOFF_CHARACTER_CAP, TASK_KICKOFF_TOKEN_CAP } from "./task-kickoff-pack.js";
import { isSafeHookSessionId } from "./task-kickoff-store.js";

export const RESUME_CAPSULE_FILENAME = "resume-capsule.json";
export const RESUME_CAPSULE_MAX_AGE_MS = 24 * 60 * 60_000;

const resumeCapsuleSchema = z
  .object({
    version: z.literal(1),
    sourceSessionId: z.string().min(1),
    text: z.string().min(1).max(TASK_KICKOFF_CHARACTER_CAP),
    tokenCount: z.number().int().nonnegative().max(TASK_KICKOFF_TOKEN_CAP),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export type ResumeCapsule = z.infer<typeof resumeCapsuleSchema>;

export function resumeCapsulePath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKeySchema.parse(workspaceKey), RESUME_CAPSULE_FILENAME);
}

export function writeResumeCapsule(
  storeRoot: string,
  workspaceKey: string,
  capsule: ResumeCapsule,
): void {
  const path = resumeCapsulePath(storeRoot, workspaceKey);
  const validated = resumeCapsuleSchema.parse(capsule);
  const dir = dirname(path);
  // Owner-only: the capsule holds redacted-but-private working context.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Rename-claim: the rename is the at-most-once gate — the first consumer wins
// and every later caller sees ENOENT. Stale or malformed capsules are removed
// rather than delivered (prefer-loss, amendment 2026-08-01 §1 posture).
export function consumeResumeCapsule(
  storeRoot: string,
  workspaceKey: string,
  claimingSessionId: string,
  now: () => number = Date.now,
): ResumeCapsule | null {
  if (!isSafeHookSessionId(claimingSessionId)) return null;
  try {
    const path = resumeCapsulePath(storeRoot, workspaceKey);
    const claimed = join(
      dirname(path),
      `.resume-capsule-consumed-${claimingSessionId}.json`,
    );
    renameSync(path, claimed); // throws ENOENT when nothing is pending
    let raw: string;
    try {
      raw = readFileSync(claimed, "utf8");
    } finally {
      rmSync(claimed, { force: true });
    }
    const parsed = resumeCapsuleSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (now() - parsed.data.createdAt > RESUME_CAPSULE_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
```

- [ ] Run the test file — expect PASS.
- [ ] Commit: `feat(cli): resume capsule pending store`

---

### Task 4: resume gather (both layouts, liveness, sources)

**Files:**
- `apps/cli/src/commands/resume/gather.ts` (new)
- `apps/cli/test/commands/resume-gather.test.ts` (new)

**Interfaces:**

```ts
export const RESUME_LIVE_WINDOW_MS = 10 * 60_000;

export type ResumeFreshness = "unchanged" | "changed" | "missing" | "unknown";
export type ResumeFilePointer = {
  path: string;
  chunkSetId: string;
  chunkCount: number;
  createdAt: string;
  freshness: ResumeFreshness;
};
export type ResumeOutputPointer = {
  kind: "command" | "grep" | "fetch";
  label: string; // redacted
  chunkSetId: string;
  chunkCount: number;
  createdAt: string;
};
export type ResumeStatsLine = {
  eventsTotal: number;
  rawBytesTotal: number;
  returnedBytesTotal: number;
  savingRatio: number;
} | null;
export type ResumeTarget =
  | {
      layout: "registry";
      sessionId: string;
      projectName: string;
      agentId: string;
      title: string | null;
      startedAt: string;
      endedAt: string | null;
      workspaceKey: string; // encodeWorkspaceKey(project.rootPath)
      sessionDir: string;   // <store>/content/<projectId>/<sessionId>
      projectId: string;
    }
  | {
      layout: "overlay";
      sessionId: string;    // liveSessionId
      workspaceKey: string;
      updatedAt: string;
      sessionDir: string;   // <store>/content/<workspaceKey>/<liveSessionId>
    };
export type ResumeLiveness =
  | { verdict: "live"; source: "mesh" }
  | { verdict: "recently-active"; source: "activity" }
  | { verdict: "presumed-dead"; source: "activity" };
export type ResumeSources = {
  target: ResumeTarget;
  lastActivityAt: string | null;
  liveness: ResumeLiveness;
  intent: { prompt: string; ts: number } | null;
  files: readonly ResumeFilePointer[];
  outputs: readonly ResumeOutputPointer[];
  stats: ResumeStatsLine;
  omissions: readonly string[];
};

export function readMeshPresenceLastSeenMs(storeRoot: string, liveSessionId: string): number | null;
export async function resolveResumeTarget(input: {
  storeRoot: string;
  sessionId: string;
}): Promise<ResumeTarget | null>;
export async function resolveLastResumeTarget(input: {
  storeRoot: string;
  cwd: string;
}): Promise<ResumeTarget | null>;
export async function gatherResumeSources(input: {
  storeRoot: string;
  target: ResumeTarget;
  nowMs: number;
}): Promise<ResumeSources>;
```

Implementation notes (all symbols proven present):
- Registry resolution: `ensureStoreReady` (`apps/cli/src/store.ts:79`) → `registry.getSession` / `registry.listSessions` / `registry.getProject` (`packages/core/src/registry.ts:71-74`); guard the id with `sessionIdSchema.safeParse` (`@megasaver/shared`) before `getSession`.
- Overlay resolution: `readOverlaySummaryAnyWorkspace({ root: storeRoot }, sessionId)` via `@megasaver/core` (usage precedent `apps/cli/src/commands/audit/session.ts:49`).
- `resolveLastResumeTarget`: overlay candidates = files `<id>.json` under `stats/<encodeWorkspaceKey(cwd)>/` validated through `readOverlaySummary` (Task 2), excluding `.events.jsonl`, `session-intent.json`, `resume-capsule.json`, and subdirectories; registry candidates = `registry.listSessions(project.id)` for `findProjectByCwd(registry.listProjects(), cwd)` (`apps/cli/src/commands/warmup.ts`, import precedent `apps/cli/src/hooks/warmup-run.ts:12`). Newest by last activity; tie → lexicographically smaller session id.
- Chunk-set inventory: `listChunkSets` / `listOverlayChunkSets` (`@megasaver/content-store`; allow-listed in the CLI dep graph). Wrap in try/catch → omission `"(chunk sets unreadable)"`.
- Read-index: `loadReadIndex(sessionDir)` from `@megasaver/context-gate` (`packages/context-gate/src/read-index.ts:21`, exported via package index); `sessionDir` layouts per `packages/context-gate/src/run.ts:117` and `:353`.
- Freshness: for each summary with `source.kind === "file"`, sha256 of the current file bytes (`createHash("sha256")`, mirroring `hashContent`, `packages/context-gate/src/read-index.ts:9`) vs the read-index entry `contentHash` for any `pathHash` whose `chunkSetId` matches; no matching read-index entry → `"unknown"`; unreadable file → `"missing"`.
- Stats: registry → `readSummary` via `@megasaver/core` re-export (precedent: `apps/cli/src/commands/session/saver/stats.ts`); overlay → `readOverlaySummary` (Task 2). Null → omission `"(no stats recorded)"`.
- Intent: read `stats/<workspaceKey>/intent/<sessionId>.json` via `sessionIntentFilePath` (`apps/cli/src/hooks/intent-run.ts:65`), falling back to `intentFilePath` (`:61`); parse `{ prompt: string, ts: number }` with a local Zod schema, deliberately WITHOUT the 30-min TTL `readSessionIntent` applies — resurrection wants historical intent, labeled with its timestamp.
- Mesh: tolerant reader of `join(storeRoot, "mesh", "presence", liveSessionId + ".json")`, reading the ISO-offset `lastSeenAt` field per the session-mesh plan's locked `presenceRecordSchema` (`docs/superpowers/plans/2026-08-06-session-mesh.md` Task 1) — no strict parse, extra record fields ignored; any read/parse failure → null (fail-open). Overlay targets only: an overlay target's sessionId IS the liveSessionId mesh keys presence by; registry session ids have no liveSessionId mapping, so registry targets skip the mesh probe entirely.
- Liveness: (overlay targets) mesh `lastSeenAt` within `RESUME_LIVE_WINDOW_MS` of `nowMs` → `live`; else (both layouts) lastActivity within the window → `recently-active`; else `presumed-dead`.
- `lastActivityAt`: overlay → `summary.updatedAt`; registry → `endedAt` ?? newest chunk-set `createdAt` ?? `startedAt`.

- [ ] Write failing tests `apps/cli/test/commands/resume-gather.test.ts` (harness style: `apps/cli/test/hooks/task-kickoff.test.ts` beforeEach; overlay fixtures per `packages/content-store/test/overlay-store.test.ts`). Cases:

```ts
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { join } from "node:path";
import { saveChunkSet, saveOverlayChunkSet } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gatherResumeSources,
  readMeshPresenceLastSeenMs,
  resolveResumeTarget,
} from "../../src/commands/resume/gather.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_ID = "55555555-5555-4555-8555-555555555555";
const tmpdir = () => realpathSync(readTemporaryDirectory());

let storeRoot: string;
let projectRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-resume-gather-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-resume-gather-project-"));
  writeFileSync(join(projectRoot, "auth.ts"), "export const x = 1;\n");
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  } as never);
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "auth fix",
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    endedAt: null,
  } as never);
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("resolveResumeTarget", () => {
  it("resolves a registry session with its project workspace key", async () => {
    const target = await resolveResumeTarget({ storeRoot, sessionId: SESSION_ID });
    expect(target?.layout).toBe("registry");
    expect(target?.workspaceKey).toBe(encodeWorkspaceKey(projectRoot));
  });

  it("resolves an overlay live session from its stats summary", async () => {
    const wk = encodeWorkspaceKey(projectRoot);
    mkdirSync(join(storeRoot, "stats", wk), { recursive: true });
    writeFileSync(
      join(storeRoot, "stats", wk, `${LIVE_ID}.json`),
      JSON.stringify({
        liveSessionId: LIVE_ID,
        eventsTotal: 2,
        rawBytesTotal: 2000,
        returnedBytesTotal: 400,
        bytesSavedTotal: 1600,
        savingRatio: 0.8,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 2,
        updatedAt: new Date(NOW - 30 * 60_000).toISOString(),
      }),
    );
    const target = await resolveResumeTarget({ storeRoot, sessionId: LIVE_ID });
    expect(target?.layout).toBe("overlay");
    expect(target?.workspaceKey).toBe(wk);
  });

  it("returns null for an unknown session id", async () => {
    await expect(
      resolveResumeTarget({ storeRoot, sessionId: "no-such-session" }),
    ).resolves.toBeNull();
  });
});

describe("gatherResumeSources", () => {
  it("joins the read-index to file chunk sets and marks freshness", async () => {
    const filePath = join(projectRoot, "auth.ts");
    await saveChunkSet({
      storeRoot,
      chunkSet: {
        chunkSetId: "cs-file-1",
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: new Date(NOW - 1_800_000).toISOString(),
        source: { kind: "file", path: filePath },
        rawBytes: 20,
        redacted: true,
        chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 20, text: "export const x = 1;" }],
      } as never,
    });
    // read-index entry recording the hash of DIFFERENT content -> "changed"
    const sessionDir = join(storeRoot, "content", PROJECT_ID, SESSION_ID);
    writeFileSync(
      join(sessionDir, "read-index.json"),
      JSON.stringify({ deadbeef: { contentHash: "0".repeat(64), chunkSetId: "cs-file-1" } }),
    );
    const target = await resolveResumeTarget({ storeRoot, sessionId: SESSION_ID });
    if (target === null) throw new Error("target fixture missing");
    const sources = await gatherResumeSources({ storeRoot, target, nowMs: NOW });
    expect(sources.files).toHaveLength(1);
    expect(sources.files[0]?.freshness).toBe("changed");
    expect(sources.liveness.verdict).toBe("presumed-dead");
  });

  it("degrades every missing source to a labeled omission", async () => {
    const target = await resolveResumeTarget({ storeRoot, sessionId: SESSION_ID });
    if (target === null) throw new Error("target fixture missing");
    const sources = await gatherResumeSources({ storeRoot, target, nowMs: NOW });
    expect(sources.files).toHaveLength(0);
    expect(sources.stats).toBeNull();
    expect(sources.omissions.length).toBeGreaterThan(0);
  });
});

describe("readMeshPresenceLastSeenMs", () => {
  it("reads a fresh presence stamp and tolerates a malformed one", () => {
    const dir = join(storeRoot, "mesh", "presence");
    mkdirSync(dir, { recursive: true });
    // Fixture mirrors the mesh presenceRecordSchema: liveSessionId +
    // ISO-offset lastSeenAt; the reader ignores every other field.
    writeFileSync(
      join(dir, `${LIVE_ID}.json`),
      JSON.stringify({
        liveSessionId: LIVE_ID,
        status: "idle",
        lastSeenAt: new Date(NOW - 60_000).toISOString(),
      }),
    );
    expect(readMeshPresenceLastSeenMs(storeRoot, LIVE_ID)).toBe(NOW - 60_000);
    writeFileSync(join(dir, `${LIVE_ID}.json`), "{broken");
    expect(readMeshPresenceLastSeenMs(storeRoot, LIVE_ID)).toBeNull();
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli test -- test/commands/resume-gather.test.ts` — expect FAIL: module not found.
- [ ] Implement `apps/cli/src/commands/resume/gather.ts` per the interface and notes above (≤ 300 LOC; split a `freshness.ts` sibling if it grows past the §8 limit). Every external read wrapped: catch → omission string, never throw. Reference sketch for the non-obvious control flow (per-source try/catch-to-omission; helpers per the notes above):

```ts
export function readMeshPresenceLastSeenMs(
  storeRoot: string,
  liveSessionId: string,
): number | null {
  // Locked by the session-mesh plan's presenceRecordSchema: ISO-offset
  // lastSeenAt, file keyed by liveSessionId. Tolerant: extra fields
  // ignored, any failure -> null (fail-open).
  try {
    const raw = JSON.parse(
      readFileSync(join(storeRoot, "mesh", "presence", `${liveSessionId}.json`), "utf8"),
    ) as { lastSeenAt?: unknown };
    if (typeof raw.lastSeenAt !== "string") return null;
    const ms = Date.parse(raw.lastSeenAt);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export async function gatherResumeSources(input: {
  storeRoot: string;
  target: ResumeTarget;
  nowMs: number;
}): Promise<ResumeSources> {
  const { storeRoot, target, nowMs } = input;
  const omissions: string[] = [];

  let summaries: readonly ChunkSetSummary[] = [];
  try {
    summaries =
      target.layout === "registry"
        ? await listChunkSets({ storeRoot, projectId: target.projectId, sessionId: target.sessionId })
        : await listOverlayChunkSets({
            storeRoot,
            workspaceKey: target.workspaceKey,
            liveSessionId: target.sessionId,
          });
  } catch {
    omissions.push("(chunk sets unreadable)");
  }

  // loadReadIndex never throws (returns {} on any failure); freshness joins
  // read-index entries to file-kind summaries by chunkSetId, rehashing the
  // current file bytes. No entry -> "unknown"; unreadable file -> "missing".
  const index = loadReadIndex(target.sessionDir);
  const files: ResumeFilePointer[] = [];
  const outputs: ResumeOutputPointer[] = [];
  for (const summary of [...summaries].sort(byCreatedAtDesc)) {
    if (summary.source.kind === "file") {
      files.push({ ...pointerOf(summary), freshness: classifyFreshness(summary, index) });
    } else {
      outputs.push(outputPointerOf(summary)); // label passed through redact()
    }
  }

  let stats: ResumeStatsLine = null;
  try {
    stats = readStatsLine(storeRoot, target); // registry: readSummary; overlay: readOverlaySummary
  } catch {
    stats = null;
  }
  if (stats === null) omissions.push("(no stats recorded)");

  let intent: { prompt: string; ts: number } | null = null;
  try {
    intent = readHistoricalIntent(storeRoot, target); // TTL-free, per notes
  } catch {
    intent = null;
  }
  if (intent === null) omissions.push("(no captured intent)");

  const lastActivityAt = deriveLastActivityAt(target, summaries); // per notes
  const meshLastSeenMs =
    target.layout === "overlay" ? readMeshPresenceLastSeenMs(storeRoot, target.sessionId) : null;
  const liveness: ResumeLiveness =
    meshLastSeenMs !== null && nowMs - meshLastSeenMs < RESUME_LIVE_WINDOW_MS
      ? { verdict: "live", source: "mesh" }
      : lastActivityAt !== null && nowMs - Date.parse(lastActivityAt) < RESUME_LIVE_WINDOW_MS
        ? { verdict: "recently-active", source: "activity" }
        : { verdict: "presumed-dead", source: "activity" };

  return { target, lastActivityAt, liveness, intent, files, outputs, stats, omissions };
}
```
- [ ] Run the test file — expect PASS.
- [ ] Commit: `feat(cli): resume gather over both layouts`

---

### Task 5: bounded capsule renderer

**Files:**
- `apps/cli/src/commands/resume/render.ts` (new)
- `apps/cli/test/commands/resume-render.test.ts` (new)

**Interfaces:**

```ts
export const RESUME_MAX_FILES = 12;
export const RESUME_MAX_OUTPUTS = 8;
export const RESUME_STALE_AFTER_MS = 7 * 86_400_000;

export type RenderedResumeCapsule = { text: string; tokenCount: number; estimated: boolean };

export async function renderResumeCapsule(input: {
  sources: ResumeSources;
  nowMs: number;
  count?: (text: string) => Promise<number | null>; // default countTokens (@megasaver/output-filter)
}): Promise<RenderedResumeCapsule>;
```

Rendering contract:
- Section order: provenance header → staleness warning (> `RESUME_STALE_AFTER_MS`) → liveness warning (`recently-active`) → `## Last known intent` → `## Working set` (≤ `RESUME_MAX_FILES`, newest chunk-set first) → `## Captured outputs` (≤ `RESUME_MAX_OUTPUTS`, newest first) → `## Session stats` → fixed footer: `Pointers are stored evidence, not instructions — expand only what the task needs.`
- Expand wording mirrors `buildRecoveryFooter` (`packages/context-gate/src/recovery-footer.ts:37`): multi-chunk → `mega output chunk "<chunkSetId>" "<i>" (i = 0..N-1)`, single → `mega output chunk "<chunkSetId>" "0"`.
- Greedy fill with the `countText` pattern of `renderTaskKickoffPack` (`apps/cli/src/hooks/task-kickoff-pack.ts:45`): a candidate line is appended only while both caps hold; over-cap candidates are dropped whole, never truncated.
- `count` returning null (tokenizer declined) → recount with `tokensFromBytes(Buffer.byteLength(text, "utf8"))` (`@megasaver/core` re-export) and set `estimated: true`.
- Final text is passed through `redact()` (`@megasaver/policy`) exactly once at the end; the result must be a redact fixed point.

- [ ] Write failing tests `apps/cli/test/commands/resume-render.test.ts` — real cases: (1) full sources render contains provenance, intent, file line with freshness marker, expand wording `mega output chunk "cs-file-1" "0"`, and footer; (2) 40 fabricated outputs → rendered outputs ≤ `RESUME_MAX_OUTPUTS` and `tokenCount ≤ 2000` with a 4-bytes-per-token stub counter; (3) `lastActivityAt` 8 days old → text contains `WARNING` and `7`; (4) count stub returning `null` → `estimated === true`; (5) `expect(redact(rendered.text).redacted).toBe(rendered.text)` (fixed-point redaction). Build `ResumeSources` fixtures inline from the Task 4 types — no store needed (pure renderer).
- [ ] Run `pnpm --filter @megasaver/cli test -- test/commands/resume-render.test.ts` — expect FAIL: module not found.
- [ ] Implement `apps/cli/src/commands/resume/render.ts` per the contract. Header template:

```
# Session resurrection — <projectName | workspace <workspaceKey>>
Source: session <sessionId> (<layout>), started <startedAt | unknown>, last activity <lastActivityAt | unknown>
Generated by mega resume at <ISO nowMs>. Evidence pointers below expand via the mega CLI.
```

Reference sketch for the greedy dual-cap fill (adapts `countText`, `apps/cli/src/hooks/task-kickoff-pack.ts:45` — one deliberate divergence: a tokenizer decline estimates via `tokensFromBytes` instead of dropping the pack):

```ts
type Counted = { text: string; tokenCount: number; estimated: boolean };

async function measure(
  lines: readonly string[],
  count: (text: string) => Promise<number | null>,
): Promise<Counted | null> {
  const text = `${lines.join("\n")}\n`;
  if (text.length > TASK_KICKOFF_CHARACTER_CAP) return null; // char cap: drop whole
  try {
    const tokenCount = await count(text);
    if (tokenCount === null) {
      return { text, tokenCount: tokensFromBytes(Buffer.byteLength(text, "utf8")), estimated: true };
    }
    if (!Number.isFinite(tokenCount) || tokenCount < 0) return null;
    return { text, tokenCount, estimated: false };
  } catch {
    return null;
  }
}

export async function renderResumeCapsule(input: {
  sources: ResumeSources;
  nowMs: number;
  count?: (text: string) => Promise<number | null>;
}): Promise<RenderedResumeCapsule> {
  const count = input.count ?? countTokens;
  // Mandatory skeleton first: header + warnings + footer are measured
  // together so the footer can never be squeezed out by optional lines.
  const head = [...headerLines(input.sources), ...warningLines(input.sources, input.nowMs)];
  const foot = [FOOTER_LINE];
  let counted = await measure([...head, ...foot], count);
  if (counted === null) throw new Error("unreachable: mandatory skeleton exceeds caps");

  let lines = [...head];
  // Optional lines in section order: intent -> working set (<= RESUME_MAX_FILES,
  // newest chunk-set first) -> outputs (<= RESUME_MAX_OUTPUTS, newest first)
  // -> stats. Greedy: append only while BOTH caps hold with the footer still
  // attached; over-cap candidates are dropped whole, never truncated.
  for (const line of optionalLines(input.sources)) {
    const prospective = await measure([...lines, line, ...foot], count);
    if (prospective !== null && prospective.tokenCount <= TASK_KICKOFF_TOKEN_CAP) {
      lines = [...lines, line];
      counted = prospective;
    }
  }

  // redact() exactly once, at the end; the result must be a redact fixed point.
  const text = redact(counted.text).redacted;
  return { text, tokenCount: counted.tokenCount, estimated: counted.estimated };
}
```

- [ ] Run the test file — expect PASS.
- [ ] Commit: `feat(cli): bounded resume capsule renderer`

---

### Task 6: `mega resume` command

**Files:**
- `apps/cli/src/commands/resume/index.ts` (new)
- `apps/cli/src/main.ts` (register `resume: resumeCommand` in `subCommands`, `apps/cli/src/main.ts:60`)
- `apps/cli/test/commands/resume-command.test.ts` (new)

**Interfaces:**

```ts
export type RunResumeInput = {
  sessionId: string | undefined;
  last: boolean;
  copy: boolean;
  next: boolean;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  copyText?: (text: string) => void; // default: darwin pbcopy, best-effort
};
export async function runResume(input: RunResumeInput): Promise<0 | 1>;
export const resumeCommand: ReturnType<typeof defineCommand>;
```

Behavior (io-injected, exit 0|1, patterned on `runSessionList`, `apps/cli/src/commands/session/list.ts:19`):
1. `resolveStorePath(readStoreEnv(...))`-style store resolution; `ensureStoreReady`.
2. Target: `sessionId` → `resolveResumeTarget`; `--last` → `resolveLastResumeTarget`; neither → `error: pass a session id or --last`, exit 1; unresolved → `error: session "<id>" not found`, exit 1.
3. `gatherResumeSources`; liveness `live` → `error: session "<id>" appears live (mesh presence); resurrection refused`, exit 1; `recently-active` → stderr warning, continue.
4. `renderResumeCapsule`.
5. `--next`: `platform === "win32"` → `error: --next requires POSIX (task-kickoff persistence)`, exit 1; `findProjectByCwd(registry.listProjects(), cwd)` null → `error: no registered project for this workspace; run mega project create`, exit 1; else `writeResumeCapsule(storeRoot, encodeWorkspaceKey(project.rootPath), { version: 1, sourceSessionId, text, tokenCount, createdAt: now() })` and print `queued resurrection capsule for the next session in "<project.name>"`.
6. Default: print capsule text to stdout; `--json`: single `JSON.stringify({ sessionId, layout, lastActivityAt, liveness, tokenCount, estimated, text })`; `--copy`: `copyText` (default darwin `pbcopy` of the capsule TEXT, best-effort, mirroring `defaultCopyPath`, `apps/cli/src/commands/handoff/pack.ts:53`; non-darwin → stderr warning) and still print.

citty args: `sessionId` positional (`required: false`), `last`/`copy`/`next`/`json` boolean flags, `store` string — arg plumbing mirrors `sessionListCommand` (`apps/cli/src/commands/session/list.ts:68`).

- [ ] Write failing tests `apps/cli/test/commands/resume-command.test.ts` (store/project/session seeding as in Task 4; io captured via arrays): (1) stdout mode prints a capsule containing `# Session resurrection`; exit 0; (2) unknown id → exit 1, stderr `not found`; (3) overlay target (seeded overlay summary for `LIVE_ID` as in Task 4) plus a fresh presence record at `mesh/presence/<LIVE_ID>.json` carrying `lastSeenAt` one minute before `now` → exit 1, stderr `refused` (registry targets never mesh-gate); (4) `--next` on a seeded POSIX store writes `resumeCapsulePath(storeRoot, encodeWorkspaceKey(projectRoot))` (skip on win32 with `it.skipIf(process.platform === "win32")`); (5) `--next` with `platform: "win32"` injected → exit 1, no capsule file; (6) `--json` output parses and carries `tokenCount`; (7) `--copy` invokes the injected `copyText` with the capsule text.
- [ ] Run `pnpm --filter @megasaver/cli test -- test/commands/resume-command.test.ts` — expect FAIL: module not found.
- [ ] Implement `apps/cli/src/commands/resume/index.ts`; register in `main.ts`. Reference sketch for the mode dispatch (error mapping mirrors `runSessionList`, `apps/cli/src/commands/session/list.ts:19`):

```ts
export async function runResume(input: RunResumeInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({ storeFlag: input.storeFlag, cwd: input.cwd, home: input.home,
      xdgDataHome: input.xdgDataHome, platform: input.platform, localAppData: input.localAppData });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);

    if (input.sessionId === undefined && !input.last) {
      input.stderr("error: pass a session id or --last");
      return 1;
    }
    const target =
      input.sessionId !== undefined
        ? await resolveResumeTarget({ storeRoot: rootDir, sessionId: input.sessionId })
        : await resolveLastResumeTarget({ storeRoot: rootDir, cwd: input.cwd });
    if (target === null) {
      input.stderr(`error: session "${input.sessionId ?? "--last"}" not found`);
      return 1;
    }

    const sources = await gatherResumeSources({ storeRoot: rootDir, target, nowMs: input.now() });
    if (sources.liveness.verdict === "live") {
      input.stderr(`error: session "${target.sessionId}" appears live (mesh presence); resurrection refused`);
      return 1;
    }
    if (sources.liveness.verdict === "recently-active") {
      input.stderr(`warning: session "${target.sessionId}" was active in the last 10 min; resuming anyway`);
    }

    const rendered = await renderResumeCapsule({ sources, nowMs: input.now() });

    // Mode dispatch: --next is exclusive (persist, print receipt, done);
    // --json replaces the text emit; --copy composes with the default print.
    if (input.next) {
      if (input.platform === "win32") {
        input.stderr("error: --next requires POSIX (task-kickoff persistence)");
        return 1;
      }
      const project = findProjectByCwd(registry.listProjects(), input.cwd);
      if (project === null) {
        input.stderr("error: no registered project for this workspace; run mega project create");
        return 1;
      }
      writeResumeCapsule(rootDir, encodeWorkspaceKey(project.rootPath), {
        version: 1, sourceSessionId: target.sessionId, text: rendered.text,
        tokenCount: rendered.tokenCount, createdAt: input.now(),
      });
      input.stdout(`queued resurrection capsule for the next session in "${project.name}"`);
      return 0;
    }
    if (input.json) {
      input.stdout(JSON.stringify({
        sessionId: target.sessionId, layout: target.layout,
        lastActivityAt: sources.lastActivityAt, liveness: sources.liveness,
        tokenCount: rendered.tokenCount, estimated: rendered.estimated, text: rendered.text,
      }));
      return 0;
    }
    if (input.copy) {
      try {
        (input.copyText ?? defaultCopyCapsuleText(input.platform))(rendered.text);
      } catch {
        input.stderr("warning: clipboard copy failed; capsule printed below");
      }
    }
    input.stdout(rendered.text);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}
```
- [ ] Run the test file — expect PASS. Run `pnpm --filter @megasaver/cli test -- test/known-targets.test.ts test/dependency-graph.test.ts` — dep-graph guard still green (no new package edges).
- [ ] Commit: `feat(cli): mega resume command`

---

### Task 7: kickoff delivers the pending capsule

**Files:**
- `apps/cli/src/hooks/task-kickoff.ts` (edit `prepareTaskKickoff`)
- `apps/cli/test/hooks/task-kickoff-resume-capsule.test.ts` (new)

**Interfaces:** no new exports. Change inside `prepareTaskKickoff` (`apps/cli/src/hooks/task-kickoff.ts:186`), immediately after `const workspaceKey = encodeWorkspaceKey(project.rootPath);` and its deadline check, replacing only the assignment of `rendered`:

```ts
const capsule = consumeResumeCapsule(storeRoot, workspaceKey, parsed.data.session_id, input.now);
const rendered =
  capsule !== null
    ? { text: capsule.text, tokenCount: capsule.tokenCount }
    : await renderBeforeDeadline(
        /* existing coChangeLog + buildProjectContextPack + renderTaskKickoffPack closure, unchanged */
      );
```

`consumeResumeCapsule` never throws and re-validates both caps (Task 3 schema), so the downstream `createSessionClaim` → `writePack` → envelope → `TaskKickoffEvent` path needs zero changes. The existing claim check at `task-kickoff.ts:226` runs BEFORE consumption, so an already-claimed session leaves the capsule for the next unclaimed session.

- [ ] Write failing tests `apps/cli/test/hooks/task-kickoff-resume-capsule.test.ts` (harness copied from `apps/cli/test/hooks/task-kickoff.test.ts`: temp store + registered project + `buildIndex`; generous `deadlineAtMs: Date.now() + 5_000`; `count: async (t) => Math.ceil(t.length / 4)`):

```ts
// ...imports as in task-kickoff.test.ts, plus:
import {
  consumeResumeCapsule,
  resumeCapsulePath,
  writeResumeCapsule,
} from "../../src/hooks/resume-capsule.js";
import { buildTaskKickoffHookOutput } from "../../src/hooks/task-kickoff.js";
import { taskKickoffSessionClaimPath } from "../../src/hooks/task-kickoff-store.js";

describe("task kickoff resume capsule delivery", () => {
  it.skipIf(process.platform === "win32")(
    "delivers a pending capsule through the kickoff envelope exactly once",
    async () => {
      const wk = encodeWorkspaceKey(projectRoot);
      writeResumeCapsule(storeRoot, wk, {
        version: 1,
        sourceSessionId: "dead-session-1",
        text: "# Session resurrection — demo\npointer body\n",
        tokenCount: 12,
        createdAt: Date.now() - 60_000,
      });
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "continue the auth fix", cwd: projectRoot, session_id: "next-1" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      const envelope = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(envelope.hookSpecificOutput.additionalContext).toContain("# Session resurrection");
      expect(existsSync(taskKickoffSessionClaimPath(storeRoot, "next-1"))).toBe(true);
      expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "renders the standard kickoff pack when no capsule is pending",
    async () => {
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "repair auth", cwd: projectRoot, session_id: "next-2" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      const envelope = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(envelope.hookSpecificOutput.additionalContext).toContain("# Task kickoff");
    },
  );

  it.skipIf(process.platform === "win32")(
    "leaves the capsule untouched for a session that already holds a claim",
    async () => {
      const wk = encodeWorkspaceKey(projectRoot);
      writeResumeCapsule(storeRoot, wk, {
        version: 1,
        sourceSessionId: "dead-session-1",
        text: "# Session resurrection — demo\npointer body\n",
        tokenCount: 12,
        createdAt: Date.now() - 60_000,
      });
      mkdirSync(dirname(taskKickoffSessionClaimPath(storeRoot, "claimed-1")), {
        recursive: true,
      });
      writeFileSync(taskKickoffSessionClaimPath(storeRoot, "claimed-1"), "{}\n");
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "anything", cwd: projectRoot, session_id: "claimed-1" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      expect(out).toBe("");
      expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "discards a stale capsule and falls back to the standard pack",
    async () => {
      const wk = encodeWorkspaceKey(projectRoot);
      writeResumeCapsule(storeRoot, wk, {
        version: 1,
        sourceSessionId: "dead-session-1",
        text: "# Session resurrection — stale\n",
        tokenCount: 8,
        createdAt: Date.now() - 25 * 60 * 60_000,
      });
      const out = await buildTaskKickoffHookOutput({
        payload: { prompt: "repair auth", cwd: projectRoot, session_id: "next-3" },
        storeRoot,
        now: () => Date.now(),
        deadlineAtMs: Date.now() + 5_000,
        count: async (t) => Math.ceil(t.length / 4),
      });
      const envelope = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(envelope.hookSpecificOutput.additionalContext).toContain("# Task kickoff");
      expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(false);
      expect(consumeResumeCapsule(storeRoot, wk, "next-4")).toBeNull();
    },
  );
});
```

- [ ] Run `pnpm --filter @megasaver/cli test -- test/hooks/task-kickoff-resume-capsule.test.ts` — expect FAIL: first test's `additionalContext` contains `# Task kickoff`, not the capsule (consume not wired).
- [ ] Implement the `prepareTaskKickoff` edit (import `consumeResumeCapsule` from `./resume-capsule.js`; the branch shown above; nothing else changes).
- [ ] Run the new file AND the existing kickoff suites — expect PASS: `pnpm --filter @megasaver/cli test -- test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-hardening.test.ts test/hooks/task-kickoff-process.test.ts test/hooks/task-kickoff-worker.test.ts test/hooks/task-kickoff-resume-capsule.test.ts` (regression gate: pre-existing tests unchanged and green).
- [ ] Commit: `feat(cli): kickoff delivers resume capsule`

---

### Task 8: changeset, wiki, full verification

**Files:**
- `.changeset/session-resurrection.md` (new)
- `wiki/entities/cli.md`, `wiki/index.md`, `wiki/log.md` (updates)

- [ ] Add `.changeset/session-resurrection.md` (add `"@megasaver/content-store": minor` ONLY if Task 1's out-of-order fallback implemented the lister in this feature):

```md
---
"@megasaver/core": minor
"@megasaver/cli": minor
---

Session resurrection: `mega resume <sessionId>|--last` builds a bounded,
redacted, evidence-pointer kickoff capsule from a dead session's stored
state (stdout / --copy / --next). `--next` delivers at-most-once through
the task-kickoff UserPromptSubmit seam. Consumes `listOverlayChunkSets`
(content-store, delivered by compaction-guard) and re-exports
`readOverlaySummary` (core).
```

- [ ] Update `wiki/entities/cli.md` (new `mega resume` section), `wiki/index.md` quick-links, and append a timestamped `wiki/log.md` entry (§0 wiki-first rule).
- [ ] Run `pnpm verify` from repo root — lint + typecheck + full test suite green (DoD #4). Paste the tail of the output as evidence.
- [ ] Feature smoke (DoD #5, captured terminal session): seed a throwaway store (`mega project create`, one session, one `mega output exec` capture), kill the shell, then run `mega resume --last`, `mega resume --last --json`, and `mega resume --last --next` followed by one installed-hook prompt showing the capsule in `additionalContext`.
- [ ] Commit: `chore: changeset + wiki for session resurrection`
- [ ] Hand off to `code-reviewer` AND `critic` (separate fresh contexts, §9.6) and then `verifier` with the smoke capture.

---

## Self-review checklist (for the implementing worker)

- [ ] Every task's new symbols are defined in that task or cited with a real path; grep the plan for `TODO`/`FIXME`/`placeholder` — must be zero.
- [ ] `listOverlayChunkSets` was NOT redefined in this feature (compaction-guard owns it; Task 1 guard honored).
- [ ] The mesh presence reader uses `lastSeenAt` keyed by liveSessionId (mesh plan contract) and gates overlay targets only.
- [ ] `apps/cli` gained no direct `@megasaver/stats` import (dep-graph test green).
- [ ] With no `resume-capsule.json` present, all pre-existing task-kickoff tests pass unmodified.
- [ ] Capsule text emitted anywhere satisfies `redact(text).redacted === text`.
- [ ] No test asserts wall-clock durations; all hook deadlines in tests are ≥ 5 000 ms.
