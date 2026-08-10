# Agent Blame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append-only provenance ledger for the agent era: a fail-open PostToolUse hook records `(file, line-span, liveSessionId, agent, intentDigest, chunkSetIds-in-view)` on every Edit/Write, and `mega blame <file> [--line N]` re-anchors those spans through `git blame --porcelain` at query time — overlaying each hunk with the session, the redacted intent, and the chunk-set evidence handles.

**Architecture:** New PostToolUse entry `mega hooks blame` (matcher `^(?:Edit|Write|MultiEdit|NotebookEdit)$` — the saver's `HOOK_MATCHER` at `packages/connectors/claude-code/src/hook-settings.ts:11` deliberately excludes Edit/Write; the guard sees them only PreToolUse). Capture core in `apps/cli/src/hooks/blame-run.ts` mirrors `guard-run.ts` discipline. Ledger lives in `@megasaver/stats` (`blame-event.ts`, appended via package-internal `appendPrivateLine`), consumed by the CLI ONLY through the core re-export block (`packages/core/src/index.ts:254-262` — apps/cli never imports `@megasaver/stats` directly). Query engine is pure modules (`apps/cli/src/blame/porcelain.ts`, `anchor.ts`) plus a cli-test-pattern command with injected `execGit` (precedent: `apps/cli/src/commands/memory/verify.ts:33`).

**Tech Stack:** TypeScript strict ESM, Zod boundary schemas, Vitest, Citty, `@megasaver/shared` (`encodeWorkspaceKey`, `workspaceKeySchema`), `@megasaver/shared/node` (`withFileLock`), `@megasaver/content-store` (`listOverlayChunkSets`, `ChunkSetSummary`), `@megasaver/stats` (`appendPrivateLine`), `node:crypto` (`createHash`, `randomUUID`).

## Global Constraints

- Fail-open capture (§13.4): `mega hooks blame` ALWAYS exits 0, writes nothing to stdout, and on any failure records less or nothing — it never blocks a tool call and never throws out of `runBlameHookFromProcess`.
- The hook never mutates user files: the span peek is `statSync` + `readFileSync` only, capped at `MAX_SPAN_SCAN_BYTES = 1 MiB`; everything written stays under `<storeRoot>`.
- No file content in the ledger: never persist `old_string` / `new_string` / `content`. Intent excerpt comes from the already-redacted intent file (`captureIntent` redacts via `@megasaver/policy` before persisting — `apps/cli/src/hooks/intent-run.ts:129`), clamped to 120 chars.
- Ledger is owner-only JSONL (`appendPrivateLine`, 0600/0700) at `<storeRoot>/stats/<workspaceKey>/blame-ledger.jsonl`; rotation mirrors mesh events (session-mesh plan Task 4): rename at 5 MiB to `blame-ledger-<epochMs>.jsonl` (rename, never copy-truncate), keep newest 4 rotated. Rotation runs under `withFileLock(<ledger>.lock, { deadlineMs: 50, staleMs: 5000 })`; a missed lock skips rotation but still appends (soft cap). Readers skip torn/foreign lines per-line.
- Dependency-graph invariants: apps/cli consumes the ledger via `@megasaver/core` re-exports only; no agent-specific logic enters `@megasaver/core` (the connector owns matchers; `agent: "claude-code"` is data written by the connector-installed hook, not core logic). No pnpm catalog — `workspace:*` only; no new package edges (stats→shared and cli→content-store/core already exist in the respective `package.json`s).
- Query side never silently misattributes: a span entry anchors to a hunk iff spans overlap AND the hunk's commit does not predate the record (`authorTimeMs + DRIFT_SLACK_MS >= Date.parse(entry.at)`; uncommitted hunks always pass). Non-anchoring span entries render under "recorded pre-rebase"; file-level entries render in their own section, never attached to lines.
- Tests: TDD red-first; injected clocks / `newId` / `list` / `execGit` everywhere; NO timing-tight tests, no real timers, no real git in unit tests (porcelain fixtures verified against real `git blame --porcelain` output); one integration smoke uses a real temp repo.
- Conventional commits, subject ≤ 50 chars (§10); code/comments/docs English (§11); risk MEDIUM ⇒ worktree default + `code-reviewer` pass (§12); changeset before merge (DoD #9).
- Cross-plan dependencies are skip-if-present: Task 1 is compaction-guard plan Task 1 verbatim (`docs/superpowers/plans/2026-08-06-compaction-guard.md`); Task 3 step 1 is its Task 2 `SAFE_SEGMENT` export. Whichever branch lands first ships them.

---

### Task 1: content-store — `listOverlayChunkSets` (skip-if-present)

**Files:**
- Modify: `packages/content-store/src/store.ts`
- Modify: `packages/content-store/src/index.ts`
- Test: `packages/content-store/test/overlay-list.test.ts`

**Interfaces:**
```ts
export const CAPSULE_FILENAME = "work-state-capsule.json";
export function listOverlayChunkSets(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
}): Promise<readonly ChunkSetSummary[]>;
```

- [ ] **Skip-if-present guard:** run `grep -n "listOverlayChunkSets" packages/content-store/src/index.ts`. If it is already exported (compaction-guard Task 1 landed), check the task's checkboxes and skip to Task 2.
- [ ] Otherwise execute compaction-guard plan Task 1 **verbatim** (`docs/superpowers/plans/2026-08-06-compaction-guard.md`, Task 1): failing test `test/overlay-list.test.ts` first (RED: `pnpm --filter @megasaver/content-store exec vitest run test/overlay-list.test.ts` — `listOverlayChunkSets` not exported), then the `CAPSULE_FILENAME` + `listOverlayChunkSets` implementation in `src/store.ts` (including the `assertSafeSegment` import from `./paths.js` and the `CAPSULE_FILENAME` skip lines in `listChunkSets` / `pruneOlderThan`), exports from `src/index.ts`.
- [ ] GREEN: `pnpm --filter @megasaver/content-store exec vitest run test/overlay-list.test.ts`, then `pnpm --filter @megasaver/content-store test`.
- [ ] Commit: `feat(content-store): overlay list + capsule name`

---

### Task 2: stats — blame-event ledger (append, rotate, read) + core re-export

**Files:**
- Create: `packages/stats/src/blame-event.ts`
- Modify: `packages/stats/src/index.ts` (add `export * from "./blame-event.js";` beside the existing `export * from "./task-kickoff-event.js";` at L59)
- Modify: `packages/core/src/index.ts` (extend the stats re-export block at L254-262)
- Test: `packages/stats/test/blame-event.test.ts`

**Interfaces:**
```ts
export const BLAME_LEDGER_MAX_BYTES: number;   // 5 * 1024 * 1024
export const BLAME_LEDGER_MAX_ROTATED: number; // 4
export const blameEventSchema: z.ZodType<BlameEvent>; // strict object
export type BlameEvent = {
  id: string;                       // uuid
  at: string;                       // ISO datetime with offset
  workspaceKey: string;
  sessionId: string;
  agent: string;
  file: string;                     // absolute path
  tool: "Edit" | "Write" | "MultiEdit" | "NotebookEdit";
  granularity: "span" | "file";
  span: { start: number; end: number } | null;
  intent: { digest: string; excerpt: string } | null;
  chunkSetIds: string[];            // ≤ 8 handles
};
export function blameLedgerPath(storeRoot: string, workspaceKey: string): string;
export function appendBlameEvent(store: { root: string }, event: BlameEvent, nowMs?: number): void;
export function readBlameEvents(storeRoot: string, workspaceKey: string, file?: string): BlameEvent[];
```

- [ ] Write the failing test `packages/stats/test/blame-event.test.ts`:

```ts
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BLAME_LEDGER_MAX_BYTES,
  BLAME_LEDGER_MAX_ROTATED,
  type BlameEvent,
  appendBlameEvent,
  blameLedgerPath,
  readBlameEvents,
} from "../src/blame-event.js";

let root: string;
const wk = encodeWorkspaceKey("/some/project");

function event(overrides: Partial<BlameEvent> = {}): BlameEvent {
  return {
    id: "5e4a1b1e-0000-4000-8000-000000000001",
    at: "2026-08-06T10:00:00.000+00:00",
    workspaceKey: wk,
    sessionId: "sess-1",
    agent: "claude-code",
    file: "/some/project/src/a.ts",
    tool: "Edit",
    granularity: "span",
    span: { start: 10, end: 14 },
    intent: { digest: "4f2a91c0d3e1", excerpt: "fix flaky auth test" },
    chunkSetIds: ["cs-1", "cs-2"],
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "blame-event-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("blame ledger", () => {
  it("appends and reads back a valid event", () => {
    appendBlameEvent({ root }, event());
    expect(readBlameEvents(root, wk)).toEqual([event()]);
  });

  it("filters by file and skips torn lines", () => {
    appendBlameEvent({ root }, event());
    appendBlameEvent({ root }, event({ id: "5e4a1b1e-0000-4000-8000-000000000002", file: "/some/project/src/b.ts" }));
    const path = blameLedgerPath(root, wk);
    writeFileSync(path, `${readFileSync(path, "utf8")}{"torn`);
    const got = readBlameEvents(root, wk, "/some/project/src/a.ts");
    expect(got.map((e) => e.file)).toEqual(["/some/project/src/a.ts"]);
  });

  it("returns [] for an empty store", () => {
    expect(readBlameEvents(root, wk)).toEqual([]);
  });

  it("rotates when the ledger exceeds the byte cap and prunes old rotations", () => {
    appendBlameEvent({ root }, event());
    const path = blameLedgerPath(root, wk);
    const dir = dirname(path);
    writeFileSync(path, `${JSON.stringify(event())}\n`.repeat(1 + Math.ceil(BLAME_LEDGER_MAX_BYTES / 200)));
    for (let i = 0; i < BLAME_LEDGER_MAX_ROTATED; i += 1) {
      writeFileSync(join(dir, `blame-ledger-${1000 + i}.jsonl`), `${JSON.stringify(event())}\n`);
    }
    appendBlameEvent({ root }, event({ id: "5e4a1b1e-0000-4000-8000-000000000003" }), 999_000);
    const names = readdirSync(dir).filter((n) => /^blame-ledger-\d+\.jsonl$/.test(n)).sort();
    expect(names).toEqual(["blame-ledger-1001.jsonl", "blame-ledger-1002.jsonl", "blame-ledger-1003.jsonl", "blame-ledger-999000.jsonl"]);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("rejects a schema-invalid event on append", () => {
    expect(() => appendBlameEvent({ root }, { ...event(), span: { start: 0, end: 3 } })).toThrow();
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/stats exec vitest run test/blame-event.test.ts` — module does not exist.
- [ ] Implement `packages/stats/src/blame-event.ts`:

```ts
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";
import { appendPrivateLine } from "./append-line.js";

export const BLAME_LEDGER_MAX_BYTES = 5 * 1024 * 1024;
export const BLAME_LEDGER_MAX_ROTATED = 4;

const ROTATED_LEDGER = /^blame-ledger-\d+\.jsonl$/;

export const blameEventSchema = z
  .object({
    id: z.string().uuid(),
    at: z.string().datetime({ offset: true }),
    workspaceKey: workspaceKeySchema,
    sessionId: z.string().min(1),
    agent: z.string().min(1),
    file: z.string().min(1),
    tool: z.enum(["Edit", "Write", "MultiEdit", "NotebookEdit"]),
    granularity: z.enum(["span", "file"]),
    span: z
      .object({ start: z.number().int().min(1), end: z.number().int().min(1) })
      .nullable(),
    intent: z
      .object({ digest: z.string().regex(/^[0-9a-f]{12}$/), excerpt: z.string() })
      .nullable(),
    chunkSetIds: z.array(z.string().min(1)).max(8),
  })
  .strict();

export type BlameEvent = z.infer<typeof blameEventSchema>;

export function blameLedgerPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKeySchema.parse(workspaceKey), "blame-ledger.jsonl");
}

// Mesh-events rotation discipline: rename (never copy-truncate) at the byte
// cap, keep only the newest rotations. Epoch-ms suffixes are equal-width for
// this era, so the lexicographic sort below is the numeric order.
function rotateIfOverCap(path: string, nowMs: number): void {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return; // no ledger yet — nothing to rotate
  }
  if (size <= BLAME_LEDGER_MAX_BYTES) return;
  renameSync(path, path.replace(/\.jsonl$/, `-${nowMs}.jsonl`));
  const dir = dirname(path);
  const rotated = readdirSync(dir)
    .filter((name) => ROTATED_LEDGER.test(name))
    .sort();
  for (const name of rotated.slice(0, Math.max(0, rotated.length - BLAME_LEDGER_MAX_ROTATED))) {
    rmSync(join(dir, name), { force: true });
  }
}

export function appendBlameEvent(
  store: { root: string },
  event: BlameEvent,
  nowMs: number = Date.now(),
): void {
  const parsed = blameEventSchema.parse(event);
  const path = blameLedgerPath(store.root, parsed.workspaceKey);
  const line = `${JSON.stringify(parsed)}\n`;
  // The lock file sits beside the ledger, so the dir must exist before locking.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const ran = withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
    rotateIfOverCap(path, nowMs);
    appendPrivateLine(path, line);
  });
  // The cap is soft; the record is not. appendPrivateLine holds its own flock,
  // so a contended rotation never drops provenance.
  if (!ran) appendPrivateLine(path, line);
}

export function readBlameEvents(
  storeRoot: string,
  workspaceKey: string,
  file?: string,
): BlameEvent[] {
  const live = blameLedgerPath(storeRoot, workspaceKey);
  const dir = dirname(live);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const paths = [
    ...names.filter((n) => ROTATED_LEDGER.test(n)).sort().map((n) => join(dir, n)),
    live,
  ];
  const events: BlameEvent[] = [];
  for (const path of paths) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = blameEventSchema.safeParse(JSON.parse(line));
        if (parsed.success && (file === undefined || parsed.data.file === file)) {
          events.push(parsed.data);
        }
      } catch {
        // torn or foreign line — skip, never fail the read (mesh discipline)
      }
    }
  }
  return events;
}
```

- [ ] Add `export * from "./blame-event.js";` to `packages/stats/src/index.ts` (beside L59's `export * from "./task-kickoff-event.js";`).
- [ ] Extend the core re-export block in `packages/core/src/index.ts` (the block at L257-262 whose comment reads "The CLI reads stats events only through core"): add `appendBlameEvent`, `blameLedgerPath`, `readBlameEvents`, `type BlameEvent` to that same `export { ... } from "@megasaver/stats";`.
- [ ] GREEN: `pnpm --filter @megasaver/stats exec vitest run test/blame-event.test.ts`, then `pnpm --filter @megasaver/stats test` and `pnpm --filter @megasaver/core build`.
- [ ] Commit: `feat(stats): append-only blame provenance ledger`

---

### Task 3: cli — capture core `blame-run.ts` (span, intent digest, chunk sets)

**Files:**
- Modify: `apps/cli/src/hooks/intent-run.ts` (export `SAFE_SEGMENT` — skip-if-present)
- Create: `apps/cli/src/hooks/blame-run.ts`
- Test: `apps/cli/test/hooks/blame-run.test.ts`

**Interfaces:**
```ts
export const MAX_SPAN_SCAN_BYTES: number;      // 1 MiB
export const BLAME_CHUNKSETS_MAX: number;      // 8
export const INTENT_EXCERPT_MAX_CHARS: number; // 120
export function locateUniqueSpan(content: string, needle: string): { start: number; end: number } | null;
export type BuildBlameEventInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  newId: () => string;
  list: typeof listOverlayChunkSets;
};
export function buildBlameEvent(input: BuildBlameEventInput): Promise<BlameEvent | null>;
export function runBlameHookFromProcess(storeFlag?: string): Promise<void>;
```

> **ASSUMPTION (A1):** PostToolUse `tool_input` for Edit/Write carries the fields the PreToolUse guard verifies today — `file_path`, `old_string`, `new_string`, `content`, `edits[]`, `notebook_path` (`apps/cli/src/hooks/guard-run.ts:48-66,116-120`; the saver already parses PostToolUse `session_id`/`cwd`/`tool_name`/`tool_input` in `apps/cli/src/hooks/saver.ts:322-385`, but its matcher never fires on Edit, so the Edit-shaped PostToolUse payload is unobservable in-repo). `replace_all` has NO in-repo precedent — the guard never reads it; it is assumed from the Edit tool's documented parameters only. Everything is schema-gated: absent fields degrade to file-level granularity or no record (an absent `replace_all` simply never triggers the file-level degradation) — never a crash. `tool_response` is NOT relied on.

- [ ] **Skip-if-present guard:** if `SAFE_SEGMENT` is not yet exported from `apps/cli/src/hooks/intent-run.ts` (compaction-guard Task 2 not landed), add `export` to the existing `const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;` (L35). No other change to that file.
- [ ] Write the failing test `apps/cli/test/hooks/blame-run.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChunkSetSummary } from "@megasaver/content-store";
import { readBlameEvents } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureIntent } from "../../src/hooks/intent-run.js";
import { buildBlameEvent, locateUniqueSpan } from "../../src/hooks/blame-run.js";

let storeRoot: string;
let projectDir: string;
const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const list = async (): Promise<readonly ChunkSetSummary[]> => [
  { chunkSetId: "cs-old", createdAt: "2026-08-06T09:00:00.000Z", source: { kind: "file", path: "/x" }, rawBytes: 10, redacted: false, chunkCount: 1 },
  { chunkSetId: "cs-new", createdAt: "2026-08-06T09:59:00.000Z", source: { kind: "grep", query: "q" }, rawBytes: 10, redacted: false, chunkCount: 1 },
];

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "blame-run-store-"));
  projectDir = mkdtempSync(join(tmpdir(), "blame-run-proj-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("locateUniqueSpan", () => {
  it("finds a unique multi-line needle", () => {
    expect(locateUniqueSpan("a\nb\nX\nY\nc\n", "X\nY")).toEqual({ start: 3, end: 4 });
  });
  it("returns null for empty, missing, or ambiguous needles", () => {
    expect(locateUniqueSpan("a\nb\n", "")).toBeNull();
    expect(locateUniqueSpan("a\nb\n", "z")).toBeNull();
    expect(locateUniqueSpan("dup\ndup\n", "dup")).toBeNull();
  });
  it("does not over-count a trailing newline", () => {
    expect(locateUniqueSpan("a\nXX\nb\n", "XX\n")).toEqual({ start: 2, end: 2 });
  });
});

describe("buildBlameEvent", () => {
  it("records a span for a unique Edit and carries intent digest + chunk sets", async () => {
    const file = join(projectDir, "src", "a.ts");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(file, "line1\nNEW-A\nNEW-B\nline4\n");
    captureIntent(storeRoot, { prompt: "fix flaky auth test", cwd: projectDir, session_id: "sess-1" }, () => NOW - 60_000);
    const event = await buildBlameEvent({
      payload: {
        session_id: "sess-1",
        cwd: projectDir,
        tool_name: "Edit",
        tool_input: { file_path: file, old_string: "old", new_string: "NEW-A\nNEW-B" },
      },
      storeRoot,
      now: () => NOW,
      newId: () => "5e4a1b1e-0000-4000-8000-000000000001",
      list,
    });
    expect(event).not.toBeNull();
    expect(event?.granularity).toBe("span");
    expect(event?.span).toEqual({ start: 2, end: 3 });
    expect(event?.agent).toBe("claude-code");
    expect(event?.intent?.excerpt).toBe("fix flaky auth test");
    expect(event?.intent?.digest).toMatch(/^[0-9a-f]{12}$/);
    expect(event?.chunkSetIds).toEqual(["cs-new", "cs-old"]); // newest first
  });

  it("records the whole file for Write", async () => {
    const event = await buildBlameEvent({
      payload: {
        session_id: "sess-1",
        cwd: projectDir,
        tool_name: "Write",
        tool_input: { file_path: join(projectDir, "b.ts"), content: "a\nb\nc\n" },
      },
      storeRoot,
      now: () => NOW,
      newId: () => "5e4a1b1e-0000-4000-8000-000000000002",
      list: async () => [],
    });
    expect(event?.span).toEqual({ start: 1, end: 3 });
    expect(event?.intent).toBeNull();
  });

  it("degrades to file-level for MultiEdit and for replace_all", async () => {
    const multi = await buildBlameEvent({
      payload: { session_id: "s", cwd: projectDir, tool_name: "MultiEdit", tool_input: { file_path: join(projectDir, "c.ts"), edits: [] } },
      storeRoot, now: () => NOW, newId: () => "5e4a1b1e-0000-4000-8000-000000000003", list: async () => [],
    });
    expect(multi?.granularity).toBe("file");
    expect(multi?.span).toBeNull();
    const all = await buildBlameEvent({
      payload: { session_id: "s", cwd: projectDir, tool_name: "Edit", tool_input: { file_path: join(projectDir, "c.ts"), new_string: "x", replace_all: true } },
      storeRoot, now: () => NOW, newId: () => "5e4a1b1e-0000-4000-8000-000000000004", list: async () => [],
    });
    expect(all?.granularity).toBe("file");
  });

  it("fails open: malformed payload, non-blamed tool, missing file_path", async () => {
    const base = { storeRoot, now: () => NOW, newId: () => "5e4a1b1e-0000-4000-8000-000000000005", list };
    expect(await buildBlameEvent({ payload: { nope: true }, ...base })).toBeNull();
    expect(await buildBlameEvent({ payload: { session_id: "s", cwd: projectDir, tool_name: "Read", tool_input: {} }, ...base })).toBeNull();
    expect(await buildBlameEvent({ payload: { session_id: "s", cwd: projectDir, tool_name: "Edit", tool_input: {} }, ...base })).toBeNull();
  });

  it("fails open: unsafe session_id records with no chunk sets, throwing list records []", async () => {
    const unsafe = await buildBlameEvent({
      payload: { session_id: "../evil", cwd: projectDir, tool_name: "Write", tool_input: { file_path: join(projectDir, "d.ts"), content: "x\n" } },
      storeRoot, now: () => NOW, newId: () => "5e4a1b1e-0000-4000-8000-000000000006", list,
    });
    expect(unsafe?.chunkSetIds).toEqual([]);
    const boom = await buildBlameEvent({
      payload: { session_id: "sess-1", cwd: projectDir, tool_name: "Write", tool_input: { file_path: join(projectDir, "e.ts"), content: "x\n" } },
      storeRoot, now: () => NOW, newId: () => "5e4a1b1e-0000-4000-8000-000000000007",
      list: async () => { throw new Error("store exploded"); },
    });
    expect(boom?.chunkSetIds).toEqual([]);
  });

  it("round-trips through the core ledger surface", async () => {
    const event = await buildBlameEvent({
      payload: { session_id: "sess-1", cwd: projectDir, tool_name: "Write", tool_input: { file_path: join(projectDir, "f.ts"), content: "x\n" } },
      storeRoot, now: () => NOW, newId: () => "5e4a1b1e-0000-4000-8000-000000000008", list: async () => [],
    });
    const { appendBlameEvent } = await import("@megasaver/core");
    if (event !== null) appendBlameEvent({ root: storeRoot }, event);
    const wk = encodeWorkspaceKey(projectDir);
    expect(readBlameEvents(storeRoot, wk).map((e) => e.id)).toEqual(["5e4a1b1e-0000-4000-8000-000000000008"]);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/hooks/blame-run.test.ts` — `blame-run.js` does not exist.
- [ ] Implement `apps/cli/src/hooks/blame-run.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { listOverlayChunkSets } from "@megasaver/content-store";
import { type BlameEvent, appendBlameEvent } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { SAFE_SEGMENT, readSessionIntent } from "./intent-run.js";

export const MAX_SPAN_SCAN_BYTES = 1024 * 1024;
export const BLAME_CHUNKSETS_MAX = 8;
export const INTENT_EXCERPT_MAX_CHARS = 120;

const BLAMED_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const postToolUsePayloadSchema = z
  .object({
    session_id: z.string().min(1),
    cwd: z.string().min(1),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function lineCount(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") lines += 1;
  return lines;
}

// A span is recorded only when it is certain: the needle occurs exactly once
// in the post-edit file. Anything ambiguous degrades to file-level — a wrong
// span misattributes forever, a missing span merely loses precision.
export function locateUniqueSpan(
  content: string,
  needle: string,
): { start: number; end: number } | null {
  if (needle === "") return null;
  const first = content.indexOf(needle);
  if (first === -1 || content.indexOf(needle, first + 1) !== -1) return null;
  const body = needle.endsWith("\n") ? needle.slice(0, -1) : needle;
  const start = lineCount(content.slice(0, first));
  return { start, end: start + lineCount(body) - 1 };
}

function computeSpan(
  tool: string,
  ti: Record<string, unknown>,
  file: string,
): { start: number; end: number } | null {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const content = asStr(ti["content"]);
  if (tool === "Write" && content !== undefined) {
    const body = content.endsWith("\n") ? content.slice(0, -1) : content;
    return { start: 1, end: lineCount(body) };
  }
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const newString = asStr(ti["new_string"]);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (tool !== "Edit" || newString === undefined || ti["replace_all"] === true) return null;
  try {
    if (statSync(file).size > MAX_SPAN_SCAN_BYTES) return null;
    return locateUniqueSpan(readFileSync(file, "utf8"), newString);
  } catch {
    return null;
  }
}

function intentDigestOf(prompt: string | undefined): BlameEvent["intent"] {
  if (prompt === undefined) return null;
  return {
    digest: createHash("sha256").update(prompt).digest("hex").slice(0, 12),
    excerpt: prompt.slice(0, INTENT_EXCERPT_MAX_CHARS),
  };
}

async function chunkSetIdsInView(
  input: BuildBlameEventInput,
  workspaceKey: string,
  sessionId: string,
): Promise<string[]> {
  if (!SAFE_SEGMENT.test(sessionId)) return [];
  try {
    const summaries = await input.list({
      storeRoot: input.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
    });
    return [...summaries]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, BLAME_CHUNKSETS_MAX)
      .map((s) => s.chunkSetId);
  } catch {
    return [];
  }
}

export type BuildBlameEventInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  newId: () => string;
  list: typeof listOverlayChunkSets;
};

// Contract identical to buildGuardHookOutput: NEVER throws — a crashing
// PostToolUse hook must not break the tool call (§13.4 fail-open).
export async function buildBlameEvent(input: BuildBlameEventInput): Promise<BlameEvent | null> {
  try {
    const parsed = postToolUsePayloadSchema.safeParse(input.payload);
    if (!parsed.success) return null;
    const { session_id: sessionId, cwd, tool_name: tool } = parsed.data;
    if (!BLAMED_TOOLS.has(tool)) return null;
    const ti =
      typeof parsed.data.tool_input === "object" && parsed.data.tool_input !== null
        ? (parsed.data.tool_input as Record<string, unknown>)
        : {};
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const filePath = asStr(ti["file_path"]) ?? asStr(ti["notebook_path"]);
    if (filePath === undefined) return null;
    const file = resolve(cwd, filePath);
    const workspaceKey = encodeWorkspaceKey(cwd);
    const span = computeSpan(tool, ti, file);
    return {
      id: input.newId(),
      at: new Date(input.now()).toISOString(),
      workspaceKey,
      sessionId,
      agent: "claude-code",
      file,
      tool: tool as BlameEvent["tool"],
      granularity: span === null ? "file" : "span",
      span,
      intent: intentDigestOf(readSessionIntent(input.storeRoot, workspaceKey, sessionId, input.now)),
      chunkSetIds: await chunkSetIdsInView(input, workspaceKey, sessionId),
    };
  } catch {
    return null;
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// The command Claude Code's PostToolUse blame hook invokes. ALWAYS exits 0,
// never writes stdout; on any failure records nothing. Wired by
// `mega hooks install`, not run by hand.
export async function runBlameHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const event = await buildBlameEvent({
      payload,
      storeRoot,
      now: () => Date.now(),
      newId: () => randomUUID(),
      list: listOverlayChunkSets,
    });
    if (event !== null) appendBlameEvent({ root: storeRoot }, event);
  } catch {
    // Swallow — fail-open.
  }
}
```

- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/hooks/blame-run.test.ts`; run `pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts` (protects the `SAFE_SEGMENT` export edit).
- [ ] Commit: `feat(cli): blame capture hook core`

---

### Task 4: connector — PostToolUse blame entry in hook-settings

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Test: `packages/connectors/claude-code/test/blame-hook.test.ts`

**Interfaces:**
```ts
export const BLAME_HOOK_COMMAND = "mega hooks blame";
export const BLAME_HOOK_MATCHER = "^(?:Edit|Write|MultiEdit|NotebookEdit)$";
export function hasBlameHook(settings: unknown, command: string): boolean;
export function addBlameHook(settings: unknown, command: string): SettingsObject;
export function removeBlameHook(settings: unknown, command: string): SettingsObject;
// InstallClaudeCodeHookInput gains: blame?: boolean
// ClaudeCodeHookStatus gains: blameInstalled: boolean
// buildHookCommand subcommand union gains "blame"
```

- [ ] Write the failing test `packages/connectors/claude-code/test/blame-hook.test.ts` (fixture style mirrors the existing guard-hook tests in this package — temp settings path, no real `~/.claude`):

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BLAME_HOOK_COMMAND,
  BLAME_HOOK_MATCHER,
  addBlameHook,
  hasBlameHook,
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  removeBlameHook,
  uninstallClaudeCodeHook,
} from "../src/hook-settings.js";

let dir: string;
let settingsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "blame-hook-"));
  settingsPath = join(dir, "settings.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Entry = { matcher?: string; hooks: { command: string }[] };

function postEntries(): Entry[] {
  const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
    hooks?: { PostToolUse?: Entry[] };
  };
  return parsed.hooks?.PostToolUse ?? [];
}

describe("blame hook settings", () => {
  it("install adds a blame PostToolUse entry beside the saver entry", () => {
    installClaudeCodeHook({ settingsPath });
    const entries = postEntries();
    const blame = entries.find((e) => e.hooks.some((h) => h.command === BLAME_HOOK_COMMAND));
    expect(blame?.matcher).toBe(BLAME_HOOK_MATCHER);
    expect(entries.some((e) => e.hooks.some((h) => h.command === "mega hooks saver"))).toBe(true);
    expect(readClaudeCodeHookStatus({ settingsPath }).blameInstalled).toBe(true);
  });

  it("blame: false skips the entry; uninstall strips it cleanly", () => {
    installClaudeCodeHook({ settingsPath, blame: false });
    expect(hasBlameHook(JSON.parse(readFileSync(settingsPath, "utf8")), BLAME_HOOK_COMMAND)).toBe(false);
    installClaudeCodeHook({ settingsPath });
    uninstallClaudeCodeHook({ settingsPath });
    expect(readFileSync(settingsPath, "utf8")).not.toContain("mega hooks blame");
  });

  it("add/remove round-trip preserves foreign PostToolUse hooks", () => {
    const foreign = { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool run" }] }] } };
    writeFileSync(settingsPath, JSON.stringify(foreign));
    const added = addBlameHook(foreign, BLAME_HOOK_COMMAND);
    const removed = removeBlameHook(added, BLAME_HOOK_COMMAND);
    expect(JSON.stringify(removed)).toContain("other-tool run");
    expect(JSON.stringify(removed)).not.toContain("mega hooks blame");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/blame-hook.test.ts` — symbols not exported.
- [ ] Implement in `packages/connectors/claude-code/src/hook-settings.ts`:
  - Constants beside `GUARD_HOOK_COMMAND` (L18-23): `export const BLAME_HOOK_COMMAND = "mega hooks blame";` and `export const BLAME_HOOK_MATCHER = "^(?:Edit|Write|MultiEdit|NotebookEdit)$";` with a WHY comment: same edit-tool set as `GUARD_HOOK_MATCHER` minus `Bash` (Bash mutations carry no span data), anchored for the same substring-compile reason as `HOOK_MATCHER`.
  - Add `"blame"` to the `buildHookCommand` subcommand union (L35).
  - `hasBlameHook` / `addBlameHook` / `removeBlameHook`: copy the `addGuardHook` trio (L453-484) but target `PostToolUse` and `BLAME_HOOK_MATCHER` — `entryMatchesSubcommand` / `repairEntry` key on the subcommand (`"blame"` vs `"saver"`), so the two PostToolUse entries never collide (same argument as the guard-vs-log comment at L449-452).
  - `InstallClaudeCodeHookInput` (L524-532): add `blame?: boolean;`.
  - `installClaudeCodeHook` (after the guard block, L550-552): `if (input.blame !== false) { next = addBlameHook(next, buildHookCommand("blame", cfg)); }`.
  - `uninstallClaudeCodeHook`: add `!hasBlameHook(existing, BLAME_HOOK_COMMAND)` to the no-op conjunction (L574-581) and `next = removeBlameHook(next, BLAME_HOOK_COMMAND);` to the strip sequence.
  - `ClaudeCodeHookStatus` (L594-602) + `readClaudeCodeHookStatus`: add `blameInstalled` (from `hasBlameHook`); do NOT fold it into `connected` (that stays pre+post+intent; additive field only — the GUI status route consumes the type additively).
  - `timeoutFor` (L201): leave as-is — blame gets the default 10s.
- [ ] GREEN: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/blame-hook.test.ts`, then `pnpm --filter @megasaver/connector-claude-code test` (protects install/uninstall/repair suites).
- [ ] Commit: `feat(connector): blame PostToolUse hook entry`

---

### Task 5: cli — `mega hooks blame` subcommand + install flag

**Files:**
- Create: `apps/cli/src/commands/hooks/blame.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Test: `apps/cli/test/hooks-install-blame.test.ts`

**Interfaces:**
```ts
export const hooksBlameCommand: ReturnType<typeof defineCommand>;
// RunHooksInstallInput gains: blame?: boolean  (citty flag: --no-blame)
```

- [ ] Write the failing test `apps/cli/test/hooks-install-blame.test.ts` (cli-test-pattern: inner run function, injected settingsPath and stdout/stderr — mirror the existing hooks-install tests in `apps/cli/test/`):

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHooksInstall } from "../src/commands/hooks/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hooks-install-blame-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function install(blame: boolean | undefined): string {
  const settingsPath = join(dir, "settings.json");
  const code = runHooksInstall({
    target: "claude-code",
    settingsPath,
    ...(blame !== undefined ? { blame } : {}),
    stdout: () => {},
    stderr: () => {},
    json: false,
  });
  expect(code).toBe(0);
  return readFileSync(settingsPath, "utf8");
}

describe("mega hooks install --[no-]blame", () => {
  it("installs the blame hook by default", () => {
    expect(install(undefined)).toContain("mega hooks blame");
  });
  it("--no-blame skips it", () => {
    expect(install(false)).not.toContain("mega hooks blame");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/hooks-install-blame.test.ts` — `blame` is not a known input.
- [ ] Implement `apps/cli/src/commands/hooks/blame.ts` (mirror of `saver.ts`):

```ts
import { defineCommand } from "citty";
import { runBlameHookFromProcess } from "../../hooks/blame-run.js";

// The command Claude Code's PostToolUse blame hook invokes. Appends one
// provenance line per Edit/Write to the blame ledger. SAFETY: ALWAYS exits 0
// and writes no stdout, so a failure never touches the tool result. Wired by
// `mega hooks install`, not run by hand.
export const hooksBlameCommand = defineCommand({
  meta: {
    name: "blame",
    description: "Internal: record Edit/Write provenance from a PostToolUse payload (stdin).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runBlameHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
```

- [ ] Register in `apps/cli/src/commands/hooks/index.ts`: import, `export { hooksBlameCommand } from "./blame.js";`, and `blame: hooksBlameCommand` in `subCommands` (beside `guard`).
- [ ] Wire `apps/cli/src/commands/hooks/install.ts` following the guard-flag precedent exactly: add `blame?: boolean;` to `RunHooksInstallInput` (L18-20 block); spread `...(input.blame !== undefined ? { blame: input.blame } : {})` into the `installClaudeCodeHook` call (L65-67 block); add the citty arg (L124-127 pattern, including the citty `--no-<name>` negation comment already explained at L116-118): `blame: { type: "boolean", default: true, description: "Install the Agent Blame PostToolUse hook (--no-blame to skip)." }`; pass `blame: args.blame !== false` in the handler (L149-151 block).
- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/hooks-install-blame.test.ts`, then the package's hooks-related suites (`pnpm --filter @megasaver/cli exec vitest run test/hooks-install.test.ts test/hooks-uninstall.test.ts test/hooks-status.test.ts` — adjust to the actual filenames present).
- [ ] Commit: `feat(cli): mega hooks blame + install flag`

---

### Task 6: cli — porcelain parser + drift-tolerant anchor matcher (pure)

**Files:**
- Create: `apps/cli/src/blame/porcelain.ts`
- Create: `apps/cli/src/blame/anchor.ts`
- Test: `apps/cli/test/blame/porcelain.test.ts`
- Test: `apps/cli/test/blame/anchor.test.ts`

**Interfaces:**
```ts
// porcelain.ts
export const UNCOMMITTED_SHA: string; // 40 zeros
export type BlameHunk = {
  sha: string;
  finalStart: number;
  lineCount: number;
  authorTimeMs: number | null; // null for uncommitted hunks
  author: string;
  summary: string;
};
export function parseGitBlamePorcelain(output: string): BlameHunk[];

// anchor.ts
export const DRIFT_SLACK_MS: number; // 5 * 60_000
export type AnchoredBlame = {
  overlays: { hunk: BlameHunk; entries: BlameEvent[] }[];
  fileLevel: BlameEvent[];
  unanchored: BlameEvent[];
};
export function anchorEntries(input: {
  hunks: readonly BlameHunk[];
  entries: readonly BlameEvent[];
}): AnchoredBlame;
```

Porcelain grammar verified against real output in this repo (`git blame --porcelain -L 1,3 -- packages/shared/src/file-lock.ts`): each hunk opens with `<40-hex-sha> <origLine> <finalLine> <numLines>`, continuation lines within the hunk repeat `<sha> <orig> <final>` (no count), commit metadata (`author `, `author-time ` epoch-seconds, `summary `) follows a sha's first mention, content lines start with `\t`.

> **VERIFIED (A2):** uncommitted lines blame to the all-zero sha — reproduced in this repo against the dirty working tree: `git blame --porcelain -L 20,20 -- apps/cli/src/commands/session/saver/stats.ts` opens the hunk with `0000000000000000000000000000000000000000 20 20 1`, `author Not Committed Yet`, `summary Version of ... from ...`. Note the uncommitted hunk DOES carry a real `author-time` line (local mtime epoch); the parser deliberately overrides it to `authorTimeMs: null` for the zero sha so the anchor rule's "uncommitted always anchors" path applies. Degradation note (design rationale, not assumption): the parser does not special-case beyond that mapping, so a differently-shaped uncommitted marker degrades to a normal hunk with whatever metadata git emits — never a crash.

- [ ] Write the failing parser test `apps/cli/test/blame/porcelain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UNCOMMITTED_SHA, parseGitBlamePorcelain } from "../../src/blame/porcelain.js";

const SHA = "a".repeat(40);
const FIXTURE = [
  `${SHA} 1 1 2`,
  "author Halit Ozger",
  "author-mail <x@example.com>",
  "author-time 1783706883",
  "author-tz +0300",
  "committer Halit Ozger",
  "committer-time 1783707336",
  "summary feat(core): add retry loop",
  "filename src/foo.ts",
  "\tline one",
  `${SHA} 2 2`,
  "\tline two",
  `${UNCOMMITTED_SHA} 3 3 1`,
  "author Not Committed Yet",
  "author-time 1783800000",
  "summary Version of src/foo.ts from src/foo.ts",
  "filename src/foo.ts",
  "\tline three",
  "",
].join("\n");

describe("parseGitBlamePorcelain", () => {
  it("parses hunks with cached commit metadata", () => {
    const hunks = parseGitBlamePorcelain(FIXTURE);
    expect(hunks).toEqual([
      { sha: SHA, finalStart: 1, lineCount: 2, authorTimeMs: 1783706883000, author: "Halit Ozger", summary: "feat(core): add retry loop" },
      { sha: UNCOMMITTED_SHA, finalStart: 3, lineCount: 1, authorTimeMs: null, author: "Not Committed Yet", summary: "Version of src/foo.ts from src/foo.ts" },
    ]);
  });
  it("returns [] for empty output", () => {
    expect(parseGitBlamePorcelain("")).toEqual([]);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/blame/porcelain.test.ts`.
- [ ] Implement `apps/cli/src/blame/porcelain.ts`:

```ts
export const UNCOMMITTED_SHA = "0".repeat(40);

const HEADER = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/;

export type BlameHunk = {
  sha: string;
  finalStart: number;
  lineCount: number;
  authorTimeMs: number | null;
  author: string;
  summary: string;
};

type CommitMeta = { author: string; authorTimeMs: number | null; summary: string };

export function parseGitBlamePorcelain(output: string): BlameHunk[] {
  const meta = new Map<string, CommitMeta>();
  const hunks: { sha: string; finalStart: number; lineCount: number }[] = [];
  let current: string | null = null;
  for (const line of output.split("\n")) {
    const m = HEADER.exec(line);
    if (m !== null && m[1] !== undefined && m[3] !== undefined) {
      current = m[1];
      if (!meta.has(current)) meta.set(current, { author: "", authorTimeMs: null, summary: "" });
      if (m[4] !== undefined) {
        hunks.push({ sha: current, finalStart: Number(m[3]), lineCount: Number(m[4]) });
      }
      continue;
    }
    if (current === null || line.startsWith("\t")) continue;
    const entry = meta.get(current);
    if (entry === undefined) continue;
    if (line.startsWith("author ")) entry.author = line.slice("author ".length);
    else if (line.startsWith("author-time ")) entry.authorTimeMs = Number(line.slice("author-time ".length)) * 1000;
    else if (line.startsWith("summary ")) entry.summary = line.slice("summary ".length);
  }
  return hunks.map((h) => {
    const m = meta.get(h.sha);
    return {
      ...h,
      author: m?.author ?? "",
      summary: m?.summary ?? "",
      authorTimeMs: h.sha === UNCOMMITTED_SHA ? null : (m?.authorTimeMs ?? null),
    };
  });
}
```

- [ ] Write the failing anchor test `apps/cli/test/blame/anchor.test.ts`:

```ts
import type { BlameEvent } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { DRIFT_SLACK_MS, anchorEntries } from "../../src/blame/anchor.js";
import { UNCOMMITTED_SHA, type BlameHunk } from "../../src/blame/porcelain.js";

const T = Date.parse("2026-08-06T10:00:00.000Z");

function hunk(overrides: Partial<BlameHunk>): BlameHunk {
  return { sha: "a".repeat(40), finalStart: 10, lineCount: 5, authorTimeMs: T + 60_000, author: "A", summary: "s", ...overrides };
}
function entry(overrides: Partial<BlameEvent>): BlameEvent {
  return {
    id: "5e4a1b1e-0000-4000-8000-000000000001",
    at: new Date(T).toISOString(),
    workspaceKey: "wk",
    sessionId: "sess-1",
    agent: "claude-code",
    file: "/p/src/a.ts",
    tool: "Edit",
    granularity: "span",
    span: { start: 12, end: 13 },
    intent: null,
    chunkSetIds: [],
    ...overrides,
  };
}

describe("anchorEntries", () => {
  it("anchors an overlapping span to a commit made after the record", () => {
    const got = anchorEntries({ hunks: [hunk({})], entries: [entry({})] });
    expect(got.overlays[0]?.entries).toHaveLength(1);
    expect(got.unanchored).toEqual([]);
  });

  it("always anchors overlapping spans to uncommitted hunks", () => {
    const got = anchorEntries({
      hunks: [hunk({ sha: UNCOMMITTED_SHA, authorTimeMs: null })],
      entries: [entry({})],
    });
    expect(got.overlays[0]?.entries).toHaveLength(1);
  });

  it("reports pre-rebase when the hunk's commit predates the record beyond slack", () => {
    const got = anchorEntries({
      hunks: [hunk({ authorTimeMs: T - DRIFT_SLACK_MS - 1 })],
      entries: [entry({})],
    });
    expect(got.overlays[0]?.entries).toEqual([]);
    expect(got.unanchored).toHaveLength(1);
  });

  it("reports pre-rebase when the span overlaps no hunk", () => {
    const got = anchorEntries({ hunks: [hunk({ finalStart: 100 })], entries: [entry({})] });
    expect(got.unanchored).toHaveLength(1);
  });

  it("buckets file-level entries separately, never onto hunks", () => {
    const got = anchorEntries({
      hunks: [hunk({})],
      entries: [entry({ granularity: "file", span: null })],
    });
    expect(got.overlays[0]?.entries).toEqual([]);
    expect(got.fileLevel).toHaveLength(1);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/blame/anchor.test.ts`.
- [ ] Implement `apps/cli/src/blame/anchor.ts`:

```ts
import type { BlameEvent } from "@megasaver/core";
import type { BlameHunk } from "./porcelain.js";

// A recorded edit can only be committed AT or AFTER recording time. A hunk
// whose commit predates the record therefore holds lines the entry cannot
// have written — its coordinates drifted (insertions above shifted the file).
// Slack absorbs author-time vs local-clock skew; uncommitted hunks
// (authorTimeMs null) always pass.
export const DRIFT_SLACK_MS = 5 * 60_000;

export type AnchoredBlame = {
  overlays: { hunk: BlameHunk; entries: BlameEvent[] }[];
  fileLevel: BlameEvent[];
  unanchored: BlameEvent[];
};

export function anchorEntries(input: {
  hunks: readonly BlameHunk[];
  entries: readonly BlameEvent[];
}): AnchoredBlame {
  const overlays = input.hunks.map((hunk) => ({ hunk, entries: [] as BlameEvent[] }));
  const fileLevel: BlameEvent[] = [];
  const unanchored: BlameEvent[] = [];
  for (const entry of input.entries) {
    if (entry.granularity === "file" || entry.span === null) {
      fileLevel.push(entry);
      continue;
    }
    const atMs = Date.parse(entry.at);
    let anchored = false;
    for (const overlay of overlays) {
      const h = overlay.hunk;
      const hunkEnd = h.finalStart + h.lineCount - 1;
      if (entry.span.start > hunkEnd || entry.span.end < h.finalStart) continue;
      if (h.authorTimeMs === null || h.authorTimeMs + DRIFT_SLACK_MS >= atMs) {
        overlay.entries.push(entry);
        anchored = true;
      }
    }
    if (!anchored) unanchored.push(entry);
  }
  return { overlays, fileLevel, unanchored };
}
```

- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/blame/porcelain.test.ts test/blame/anchor.test.ts`.
- [ ] Commit: `feat(cli): blame porcelain parse + anchoring`

---

### Task 7: cli — `mega blame` command, registration, smoke, changeset

**Files:**
- Create: `apps/cli/src/commands/blame.ts`
- Modify: `apps/cli/src/main.ts` (register `blame: blameCommand` in the `subCommands` map, L80-99 block)
- Test: `apps/cli/test/blame-command.test.ts`
- Create: `.changeset/agent-blame.md`

**Interfaces:**
```ts
export type ExecGit = (args: string[], cwd: string) => string;
export type RunBlameInput = {
  file: string;
  line: number | undefined;
  json: boolean;
  cwd: string;
  storeFlag: string | undefined;
  execGit?: ExecGit;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export function runBlame(input: RunBlameInput): Promise<0 | 1>;
export const blameCommand: ReturnType<typeof defineCommand>;
```

- [ ] Write the failing test `apps/cli/test/blame-command.test.ts` (cli-test-pattern; injected fake git — NO real git in unit tests):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBlameEvent, type BlameEvent } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBlame } from "../src/commands/blame.js";

const SHA = "a".repeat(40);
const T_SEC = 1783706883;
let storeRoot: string;
const repoRoot = "/repo";
const file = "/repo/src/foo.ts";
const wk = encodeWorkspaceKey(repoRoot);

const porcelain = [
  `${SHA} 1 1 2`,
  "author Halit Ozger",
  `author-time ${T_SEC}`,
  "summary feat(core): add retry loop",
  "filename src/foo.ts",
  "\tline one",
  `${SHA} 2 2`,
  "\tline two",
  "",
].join("\n");

const fakeGit = (args: string[], _cwd: string): string => {
  if (args[0] === "rev-parse") return `${repoRoot}\n`;
  if (args[0] === "blame") return porcelain;
  throw new Error(`unexpected git args: ${args.join(" ")}`);
};

function ledgerEntry(at: string): BlameEvent {
  return {
    id: "5e4a1b1e-0000-4000-8000-000000000001",
    at,
    workspaceKey: wk,
    sessionId: "sess-1",
    agent: "claude-code",
    file,
    tool: "Edit",
    granularity: "span",
    span: { start: 1, end: 2 },
    intent: { digest: "4f2a91c0d3e1", excerpt: "fix flaky auth test" },
    chunkSetIds: ["cs-1"],
    ...{},
  };
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "blame-cmd-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

async function run(json: boolean): Promise<{ code: 0 | 1; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBlame({
    file,
    line: undefined,
    json,
    cwd: repoRoot,
    storeFlag: storeRoot,
    execGit: fakeGit,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

describe("mega blame", () => {
  it("overlays an anchored session onto the hunk (json)", async () => {
    appendBlameEvent({ root: storeRoot }, ledgerEntry(new Date(T_SEC * 1000 - 60_000).toISOString()));
    const { code, out } = await run(true);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { overlays: { entries: unknown[] }[]; unanchored: unknown[] };
    expect(parsed.overlays[0]?.entries).toHaveLength(1);
    expect(parsed.unanchored).toEqual([]);
  });

  it("reports pre-rebase drift instead of misattributing (text)", async () => {
    appendBlameEvent({ root: storeRoot }, ledgerEntry(new Date(T_SEC * 1000 + 3_600_000).toISOString()));
    const { code, out } = await run(false);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("recorded pre-rebase");
    expect(out.join("\n")).toContain("sess-1");
  });

  it("renders hunks with no provenance and exits 0", async () => {
    const { code, out } = await run(false);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no recorded provenance");
  });

  it("exits 1 with stderr when git fails", async () => {
    const err: string[] = [];
    const code = await runBlame({
      file, line: undefined, json: false, cwd: repoRoot, storeFlag: storeRoot,
      execGit: () => { throw new Error("not a git repository"); },
      stdout: () => {}, stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("git blame failed");
  });
});
```

  (`storeFlag: storeRoot` assumes `readStoreEnv(storeFlag)` treats the flag as the store-root override the same way the hook commands do — mirror how existing command tests in `apps/cli/test/` inject the store and adjust the input plumbing to match, e.g. via the env-slice used by the cli-test-pattern if `runBlame` resolves the store through `resolveStorePath` inputs instead.)
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/blame-command.test.ts`.
- [ ] Implement `apps/cli/src/commands/blame.ts`:

```ts
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { type BlameEvent, readBlameEvents } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { type AnchoredBlame, anchorEntries } from "../blame/anchor.js";
import { type BlameHunk, parseGitBlamePorcelain } from "../blame/porcelain.js";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type ExecGit = (args: string[], cwd: string) => string;

// Mirrors memory/verify.ts defaultExecGit: a stuck git (index.lock) must not
// hang the CLI.
const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });

export type RunBlameInput = {
  file: string;
  line: number | undefined;
  json: boolean;
  cwd: string;
  storeFlag: string | undefined;
  execGit?: ExecGit;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function renderEntry(entry: BlameEvent, out: (line: string) => void): void {
  out(`    session ${entry.sessionId}  agent ${entry.agent}  ${entry.at}  ${entry.tool}`);
  out(
    entry.intent === null
      ? "    intent  (none recorded)"
      : `    intent  ${entry.intent.digest}  "${entry.intent.excerpt}"`,
  );
  if (entry.chunkSetIds.length > 0) {
    out(`    in view ${entry.chunkSetIds.join(", ")}`);
    out(`            recover: mega output chunk "<chunkSetId>" "<i>"`);
  }
}

function renderText(file: string, anchored: AnchoredBlame, out: (line: string) => void): void {
  out(`${file} — ${anchored.overlays.length} hunk(s)`);
  for (const { hunk, entries } of anchored.overlays) {
    const end = hunk.finalStart + hunk.lineCount - 1;
    const when = hunk.authorTimeMs === null ? "uncommitted" : new Date(hunk.authorTimeMs).toISOString().slice(0, 10);
    out(`L${hunk.finalStart}-${end}  ${hunk.sha.slice(0, 8)}  ${when}  ${hunk.author}  ${hunk.summary}`);
    if (entries.length === 0) out("    (no recorded provenance)");
    for (const entry of [...entries].sort((a, b) => (a.at < b.at ? 1 : -1))) renderEntry(entry, out);
  }
  if (anchored.fileLevel.length > 0) {
    out("File-level provenance (no line anchors):");
    for (const entry of anchored.fileLevel) renderEntry(entry, out);
  }
  if (anchored.unanchored.length > 0) {
    out("recorded pre-rebase (line anchors drifted; spans no longer align):");
    for (const entry of anchored.unanchored) renderEntry(entry, out);
  }
}

export async function runBlame(input: RunBlameInput): Promise<0 | 1> {
  const execGit = input.execGit ?? defaultExecGit;
  const file = isAbsolute(input.file) ? input.file : resolve(input.cwd, input.file);
  let hunks: BlameHunk[];
  let repoRoot: string;
  try {
    repoRoot = execGit(["rev-parse", "--show-toplevel"], dirname(file)).trim();
    const lineArgs = input.line === undefined ? [] : ["-L", `${input.line},${input.line}`];
    hunks = parseGitBlamePorcelain(
      execGit(["blame", "--porcelain", ...lineArgs, "--", relative(repoRoot, file)], repoRoot),
    );
  } catch (err) {
    input.stderr(`error: git blame failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const storeRoot = resolveStorePath(readStoreEnv(input.storeFlag));
  // Sessions usually run with cwd == repo root, but queries may run from a
  // subdirectory and older sessions from either — read both workspace keys;
  // the exact absolute-file filter makes the union safe.
  const keys = [...new Set([encodeWorkspaceKey(repoRoot), encodeWorkspaceKey(input.cwd)])];
  const entries = keys.flatMap((key) => readBlameEvents(storeRoot, key, file));
  const anchored = anchorEntries({ hunks, entries });
  if (input.json) {
    input.stdout(JSON.stringify(anchored));
    return 0;
  }
  renderText(file, anchored, input.stdout);
  return 0;
}

export const blameCommand = defineCommand({
  meta: {
    name: "blame",
    description: "git blame overlaid with agent-session provenance (intent + evidence handles).",
  },
  args: {
    file: { type: "positional", description: "File to blame.", required: true },
    line: { type: "string", description: "Restrict to one line (git blame -L N,N)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Machine-readable output." },
  },
  async run({ args }) {
    const line = typeof args.line === "string" && args.line !== "" ? Number.parseInt(args.line, 10) : undefined;
    if (line !== undefined && (Number.isNaN(line) || line < 1)) {
      console.error("error: --line must be a positive integer");
      process.exitCode = 1;
      return;
    }
    const code = await runBlame({
      file: String(args.file),
      line,
      json: args.json === true,
      cwd: process.cwd(),
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] Register in `apps/cli/src/main.ts`: import `blameCommand` and add `blame: blameCommand,` to the `subCommands` map (L80-99).
- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/blame-command.test.ts`, then `pnpm --filter @megasaver/cli test`.
- [ ] Integration smoke (DoD #5 evidence — capture the terminal session): in a temp dir, `git init` + commit a file; pipe a synthetic PostToolUse Edit payload into `node apps/cli/dist/cli.js hooks blame --store <tmpStore>` (after `pnpm build`); edit + commit; run `node apps/cli/dist/cli.js blame <file> --store <tmpStore>` and confirm the hunk shows the session, intent line, and chunk-set handles; also run with `--line`.
- [ ] Add `.changeset/agent-blame.md`: minor bumps for `@megasaver/cli`, `@megasaver/connector-claude-code`, `@megasaver/stats`, `@megasaver/core` (and `@megasaver/content-store` iff Task 1 executed here) — "Agent Blame: Edit/Write provenance ledger + mega blame query".
- [ ] Full gate: `pnpm verify`.
- [ ] Commit: `feat(cli): mega blame provenance query`

---

## Self-review

- Capture path never touches the saver/rewrite path, never blocks a tool call, never writes outside the store; ledger holds handles and digests, never file content or raw prompts. Checked against §13 (no memory-without-metadata violation: every event carries source tool, timestamp, session, scope-by-workspaceKey).
- The one unverifiable seam is flagged (A1: PostToolUse Edit payload shape, with `replace_all` explicitly marked as having no in-repo precedent) with schema-gated degradation, matching the spec's honesty constraint. A2 (uncommitted-sha porcelain) was reproduced in-repo and is recorded as VERIFIED.
- Dependency edges audited: stats→shared(/node) exists; cli→core/content-store/shared exist; no cli→stats import anywhere in the new code (core re-export only); no agent-conditional logic added to core.
- `repairEntry`/`entryMatchesSubcommand` keying on the `blame` subcommand keeps the second PostToolUse entry from colliding with the saver's — same mechanism the guard already relies on for its second PreToolUse entry.
- Known open risk for the implementer: exact filenames of existing hooks-install test suites (Task 5 GREEN step) and the store-injection plumbing in Task 7's test must be aligned with the cli-test-pattern fixtures actually present — both are marked inline where they occur.
