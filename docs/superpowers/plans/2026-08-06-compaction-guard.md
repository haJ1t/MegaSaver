# Compaction Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot a redacted work-state capsule on Claude Code's PreCompact hook and re-inject a one-screen, chunk-id-pointered recap on SessionStart `source === "compact"`, so the post-compact agent keeps its intra-session memory.

**Architecture:** Two new fail-open CLI hook handlers (`mega hooks capsule`, `mega hooks recap`) mirror the existing saver/intent/warmup hook pattern in `apps/cli/src/hooks/`. The capsule is a derived view over the overlay chunk-set store (new `listOverlayChunkSets` in `@megasaver/content-store`), persisted as a reserved sibling file `work-state-capsule.json` beside `read-index.json`. The connector (`@megasaver/connector-claude-code`) gains a `PreCompact` adder and a second SessionStart entry, wired through `installClaudeCodeHook`.

**Tech Stack:** TypeScript strict ESM, Zod boundary schemas, Vitest, Citty commands, `@megasaver/content-store` (`atomicWriteFile`, `ChunkSetSummary`), `@megasaver/policy` (`redact`), `@megasaver/shared` (`encodeWorkspaceKey`), `@megasaver/output-filter` (`estimateTokens`).

## Global Constraints

- Capsule render ≤ 2 000 tokens, enforced via `estimateTokens` in `renderCapsuleContext` (`CAPSULE_TOKEN_BUDGET = 2_000`); the rendered intent line is clamped to `INTENT_RENDER_MAX_CHARS` so a giant pasted prompt (intent files are unclamped; UserPromptSubmit stdin caps at 256 KB) cannot break the budget.
- Fail-open (§13.4): every hook entry point always exits 0 and writes/emits nothing on any failure; PreCompact never emits `{"decision":"block"}` and never writes stdout.
- Capsule persists only already-redacted labels + `redactCapsule`-passed strings; never raw content; never reads `transcript_path`.
- `work-state-capsule.json` (`CAPSULE_FILENAME`) is a reserved sibling skipped by `listChunkSets`, `listOverlayChunkSets`, and `pruneOlderThan`.
- Recap injects only when SessionStart `source === "compact"`; envelope is `hookSpecificOutput.additionalContext` with `hookEventName: "SessionStart"`.
- Keying is `(encodeWorkspaceKey(cwd), session_id)` with `session_id` gated by intent-run's `SAFE_SEGMENT`; fallback lookup bounded to `RECAP_FALLBACK_WINDOW_MS = 15 * 60_000` with an injected clock (no timing-tight tests, no real timers).
- Conventional commits ≤ 50-char subjects (§10); code/comments/docs in English (§11); risk HIGH ⇒ work in a worktree, `code-reviewer` AND `critic` passes before merge (§12).

---

### Task 1: content-store — reserved capsule filename + overlay listing

> **Cross-pair ownership:** this task is the single definition of
> `listOverlayChunkSets` in the next-wave batch. session-resurrection
> (build-order 6 of 11) consumes it instead of re-implementing it, and the
> `CAPSULE_FILENAME` skip below is part of the owned contract, so the reserved
> capsule sibling is honored regardless of landing order.

**Files:**
- Modify: `packages/content-store/src/store.ts`
- Modify: `packages/content-store/src/index.ts`
- Test: `packages/content-store/test/overlay-list.test.ts`

**Interfaces:**
```ts
// packages/content-store/src/store.ts
export const CAPSULE_FILENAME = "work-state-capsule.json";
export async function listOverlayChunkSets(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
}): Promise<readonly ChunkSetSummary[]>;
```

- [ ] Write the failing test `packages/content-store/test/overlay-list.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPSULE_FILENAME,
  listOverlayChunkSets,
  saveOverlayChunkSet,
} from "../src/index.js";

let storeRoot: string;
const wk = "wk-alpha";
const sid = "sess-1";

function overlaySet(chunkSetId: string, source: Parameters<typeof saveOverlayChunkSet>[0]["chunkSet"]["source"]) {
  return {
    chunkSetId,
    liveSessionId: sid,
    workspaceKey: wk,
    createdAt: "2026-08-06T10:00:00.000Z",
    source,
    rawBytes: 5,
    redacted: true,
    chunks: [{ id: "c0", startLine: 0, endLine: 1, bytes: 5, text: "hello" }],
  };
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "overlay-list-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("listOverlayChunkSets", () => {
  it("returns [] for a session dir that does not exist", async () => {
    await expect(listOverlayChunkSets({ storeRoot, workspaceKey: wk, liveSessionId: "nope" })).resolves.toEqual([]);
  });

  it("summarizes persisted overlay chunk-sets with their source", async () => {
    await saveOverlayChunkSet({ storeRoot, chunkSet: overlaySet("cs-file", { kind: "file", path: "src/a.ts" }) });
    await saveOverlayChunkSet({ storeRoot, chunkSet: overlaySet("cs-cmd", { kind: "command", command: "pnpm test", args: [] }) });
    const summaries = await listOverlayChunkSets({ storeRoot, workspaceKey: wk, liveSessionId: sid });
    expect(summaries.map((s) => s.chunkSetId).sort()).toEqual(["cs-cmd", "cs-file"]);
    expect(summaries.find((s) => s.chunkSetId === "cs-file")?.source).toEqual({ kind: "file", path: "src/a.ts" });
    expect(summaries.every((s) => s.redacted)).toBe(true);
  });

  it("skips the reserved capsule sibling and both index siblings", async () => {
    await saveOverlayChunkSet({ storeRoot, chunkSet: overlaySet("cs-1", { kind: "file", path: "src/a.ts" }) });
    const dir = join(storeRoot, "content", wk, sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CAPSULE_FILENAME), `${JSON.stringify({ version: 1 })}\n`);
    writeFileSync(join(dir, "read-index.json"), "{}\n");
    writeFileSync(join(dir, "shown-index.json"), "{}\n");
    const summaries = await listOverlayChunkSets({ storeRoot, workspaceKey: wk, liveSessionId: sid });
    expect(summaries.map((s) => s.chunkSetId)).toEqual(["cs-1"]);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/content-store exec vitest run test/overlay-list.test.ts` — expect failure: `CAPSULE_FILENAME` / `listOverlayChunkSets` are not exported.
- [ ] Implement in `packages/content-store/src/store.ts`, directly under `SHOWN_INDEX_FILENAME` (L21) and after `listChunkSets`:

```ts
export const CAPSULE_FILENAME = "work-state-capsule.json";

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
```

  (`isErrno`, `readdirSync`, `readFileSync`, `join`, `overlayChunkSetSchema`, `OverlayChunkSet`, `ContentStoreError`, `ChunkSetSummary` are already imported/defined in `store.ts` — see existing `listChunkSets` L101-133 and `saveOverlayChunkSet`. `assertSafeSegment` is NOT: it is defined in `packages/content-store/src/paths.ts` L5, and store.ts L18 imports only `chunkSetPath` and `overlayChunkSetPath` from `./paths.js`.)
- [ ] Add `assertSafeSegment` to the existing `./paths.js` import in `packages/content-store/src/store.ts` (L18) — the code block above does not compile without it.
- [ ] Add the same `if (name === CAPSULE_FILENAME) continue;` skip line inside `listChunkSets` (beside L120-121) and inside `pruneOlderThan` (beside L290-291).
- [ ] Export both from `packages/content-store/src/index.ts` (append to the existing `store.js` export block that already exports `READ_INDEX_FILENAME`): `CAPSULE_FILENAME`, `listOverlayChunkSets`.
- [ ] Run `pnpm --filter @megasaver/content-store exec vitest run test/overlay-list.test.ts` — expect pass; run the package's full suite `pnpm --filter @megasaver/content-store test` (protects `read-index-skip.test.ts`, `shown-index-skip.test.ts`, `prune-overlay.test.ts`).
- [ ] Commit: `feat(content-store): overlay list + capsule name`

---

### Task 2: intent-run — TTL-free intent record + shared SAFE_SEGMENT

**Files:**
- Modify: `apps/cli/src/hooks/intent-run.ts`
- Test: `apps/cli/test/hooks/intent-record.test.ts`

**Interfaces:**
```ts
// apps/cli/src/hooks/intent-run.ts
export const SAFE_SEGMENT: RegExp; // existing private const, now exported
export type IntentRecord = { prompt: string; ts: number };
export function readLatestIntentRecord(
  storeRoot: string,
  workspaceKey: string,
  sessionId?: string,
): IntentRecord | undefined;
```

- [ ] Write the failing test `apps/cli/test/hooks/intent-record.test.ts` (store fixture mirrors `intent-run.test.ts`):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTENT_TTL_MS,
  SAFE_SEGMENT,
  captureIntent,
  readLatestIntentRecord,
  readSessionIntent,
} from "../../src/hooks/intent-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "intent-record-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("readLatestIntentRecord", () => {
  it("returns the stored prompt and ts even past the ranking TTL", () => {
    const ts = 1_000_000;
    captureIntent(storeRoot, { prompt: "fix flaky auth test", cwd, session_id: "sess-1" }, () => ts);
    const past = ts + INTENT_TTL_MS + 60_000;
    expect(readSessionIntent(storeRoot, wk, "sess-1", () => past)).toBeUndefined();
    expect(readLatestIntentRecord(storeRoot, wk, "sess-1")).toEqual({ prompt: "fix flaky auth test", ts });
  });

  it("falls back to the legacy workspace file for an unknown session id", () => {
    captureIntent(storeRoot, { prompt: "ship recap", cwd, session_id: "sess-1" }, () => 5);
    expect(readLatestIntentRecord(storeRoot, wk, "other-session")).toEqual({ prompt: "ship recap", ts: 5 });
  });

  it("returns undefined when nothing was captured", () => {
    expect(readLatestIntentRecord(storeRoot, wk, "sess-1")).toBeUndefined();
  });

  it("exports the session-id gate used by the capsule hooks", () => {
    expect(SAFE_SEGMENT.test("abc-123")).toBe(true);
    expect(SAFE_SEGMENT.test("../evil")).toBe(false);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-record.test.ts` — expect failure: `SAFE_SEGMENT` / `readLatestIntentRecord` not exported.
- [ ] Implement in `apps/cli/src/hooks/intent-run.ts`: add `export` to the existing `const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;` (L35), then add below `readSessionIntent`:

```ts
export type IntentRecord = { prompt: string; ts: number };

function readIntentRecordAt(path: string): IntentRecord | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = intentFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    const prompt = parsed.data.prompt.trim();
    return prompt === "" ? undefined : { prompt, ts: parsed.data.ts };
  } catch {
    return undefined;
  }
}

// TTL-free sibling of readSessionIntent: the capsule reports intent age instead
// of dropping it — a compaction usually lands deep into a long turn (spec LD5).
export function readLatestIntentRecord(
  storeRoot: string,
  workspaceKey: string,
  sessionId?: string,
): IntentRecord | undefined {
  if (sessionId !== undefined && SAFE_SEGMENT.test(sessionId)) {
    const scoped = readIntentRecordAt(sessionIntentFilePath(storeRoot, workspaceKey, sessionId));
    if (scoped !== undefined) return scoped;
  }
  return readIntentRecordAt(intentFilePath(storeRoot, workspaceKey));
}
```

- [ ] Run the test file — expect pass; run `pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts test/hooks/intent-command.test.ts` to prove the existing intent surface is untouched.
- [ ] Commit: `feat(cli): export TTL-free intent record read`

---

### Task 3: capsule model — schema, builder, redactor, bounded renderer

**Files:**
- Create: `apps/cli/src/hooks/capsule.ts`
- Test: `apps/cli/test/hooks/capsule.test.ts`

**Interfaces:**
```ts
// apps/cli/src/hooks/capsule.ts
export const CAPSULE_TOKEN_BUDGET = 2_000;
export const CAPSULE_VERSION = 1;
export const workStateCapsuleSchema: z.ZodType; // see body below
export type WorkStateCapsule = z.infer<typeof workStateCapsuleSchema>;
export function capsulePath(storeRoot: string, workspaceKey: string, liveSessionId: string): string;
export type BuildCapsuleInput = {
  summaries: readonly ChunkSetSummary[];
  intent?: { prompt: string; ts: number } | undefined;
  trigger: string;
  now: () => number;
};
export function buildWorkStateCapsule(input: BuildCapsuleInput): WorkStateCapsule;
export function redactCapsule(capsule: WorkStateCapsule, redactString: (s: string) => string): WorkStateCapsule;
export function renderCapsuleContext(capsule: WorkStateCapsule): string;
```

- [ ] Write the failing test `apps/cli/test/hooks/capsule.test.ts`:

```ts
import type { ChunkSetSummary } from "@megasaver/content-store";
import { estimateTokens } from "@megasaver/output-filter";
import { describe, expect, it } from "vitest";
import {
  CAPSULE_TOKEN_BUDGET,
  buildWorkStateCapsule,
  redactCapsule,
  renderCapsuleContext,
} from "../../src/hooks/capsule.js";

function summary(chunkSetId: string, createdAt: string, source: ChunkSetSummary["source"]): ChunkSetSummary {
  return { chunkSetId, createdAt, source, rawBytes: 100, redacted: true, chunkCount: 3 };
}

describe("buildWorkStateCapsule", () => {
  it("partitions sources into files, commands, and counters, newest first", () => {
    const capsule = buildWorkStateCapsule({
      summaries: [
        summary("cs-old", "2026-08-06T10:00:00.000Z", { kind: "file", path: "src/a.ts" }),
        summary("cs-new", "2026-08-06T11:00:00.000Z", { kind: "file", path: "src/b.ts" }),
        summary("cs-cmd", "2026-08-06T10:30:00.000Z", { kind: "command", command: "pnpm test", args: [] }),
        summary("cs-grep", "2026-08-06T10:31:00.000Z", { kind: "grep", query: "resolveStorePath" }),
        summary("cs-fetch", "2026-08-06T10:32:00.000Z", { kind: "fetch", url: "https://example.com/doc" }),
      ],
      trigger: "auto",
      now: () => Date.parse("2026-08-06T12:00:00.000Z"),
    });
    expect(capsule.filesTouched.map((f) => f.path)).toEqual(["src/b.ts", "src/a.ts"]);
    expect(capsule.commandsRun).toEqual([
      { command: "pnpm test", chunkSetId: "cs-cmd", createdAt: "2026-08-06T10:30:00.000Z" },
    ]);
    expect(capsule.searchCount).toBe(1);
    expect(capsule.fetchCount).toBe(1);
    expect(capsule.trigger).toBe("auto");
    expect(capsule.openDecisions).toEqual([]);
  });

  it("dedupes re-reads of the same path, keeping the newest chunk-set pointer", () => {
    const capsule = buildWorkStateCapsule({
      summaries: [
        summary("cs-1", "2026-08-06T10:00:00.000Z", { kind: "file", path: "src/a.ts" }),
        summary("cs-2", "2026-08-06T11:00:00.000Z", { kind: "file", path: "src/a.ts" }),
      ],
      trigger: "manual",
      now: () => 0,
    });
    expect(capsule.filesTouched).toEqual([
      { path: "src/a.ts", chunkSetId: "cs-2", createdAt: "2026-08-06T11:00:00.000Z" },
    ]);
  });
});

describe("redactCapsule", () => {
  it("passes every string field through the redactor", () => {
    const capsule = buildWorkStateCapsule({
      summaries: [summary("cs-1", "2026-08-06T10:00:00.000Z", { kind: "command", command: "curl -H secret", args: [] })],
      intent: { prompt: "use secret", ts: 1 },
      trigger: "auto",
      now: () => 0,
    });
    const redacted = redactCapsule(capsule, (s) => s.replaceAll("secret", "[REDACTED]"));
    expect(redacted.commandsRun[0]?.command).toBe("curl -H [REDACTED]");
    expect(redacted.intent?.prompt).toBe("use [REDACTED]");
  });
});

describe("renderCapsuleContext", () => {
  it("stays under the token budget for a huge session and points at the store", () => {
    const summaries: ChunkSetSummary[] = [];
    for (let i = 0; i < 800; i += 1) {
      summaries.push(
        summary(`cs-f${i}`, "2026-08-06T10:00:00.000Z", { kind: "file", path: `packages/core/src/very/long/path/file-${i}.ts` }),
      );
      summaries.push(
        summary(`cs-c${i}`, "2026-08-06T10:00:01.000Z", { kind: "command", command: `pnpm --filter pkg-${i} test`, args: [] }),
      );
    }
    const text = renderCapsuleContext(
      buildWorkStateCapsule({ summaries, trigger: "auto", now: () => 0 }),
    );
    expect(estimateTokens(text)).toBeLessThanOrEqual(CAPSULE_TOKEN_BUDGET);
    expect(text).toContain("more in store");
    expect(text).toContain("mega output chunk");
  });

  it("clamps a giant pasted intent prompt so the budget holds even with zero entries", () => {
    const text = renderCapsuleContext(
      buildWorkStateCapsule({
        summaries: [],
        // ~260 KB — the scale of a max-size UserPromptSubmit stdin (256 KB cap).
        intent: { prompt: "a very long pasted prompt ".repeat(10_000), ts: 1 },
        trigger: "auto",
        now: () => 0,
      }),
    );
    expect(estimateTokens(text)).toBeLessThanOrEqual(CAPSULE_TOKEN_BUDGET);
    expect(text).toContain("Task intent:");
  });

  it("lists chunk-set ids next to each receipt so details expand losslessly", () => {
    const text = renderCapsuleContext(
      buildWorkStateCapsule({
        summaries: [summary("cs-abc", "2026-08-06T10:00:00.000Z", { kind: "file", path: "src/a.ts" })],
        intent: { prompt: "fix auth", ts: 1 },
        trigger: "auto",
        now: () => 0,
      }),
    );
    expect(text).toContain("src/a.ts");
    expect(text).toContain("cs-abc");
    expect(text).toContain("fix auth");
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/capsule.test.ts` — expect failure: module `../../src/hooks/capsule.js` does not exist.
- [ ] Implement `apps/cli/src/hooks/capsule.ts`:

```ts
import { join } from "node:path";
import { CAPSULE_FILENAME, type ChunkSetSummary } from "@megasaver/content-store";
import { estimateTokens } from "@megasaver/output-filter";
import { z } from "zod";

export const CAPSULE_TOKEN_BUDGET = 2_000;
export const CAPSULE_VERSION = 1;

export const workStateCapsuleSchema = z
  .object({
    version: z.literal(CAPSULE_VERSION),
    capturedAt: z.string().datetime({ offset: true }),
    trigger: z.string().max(32),
    intent: z.object({ prompt: z.string(), ts: z.number() }).optional(),
    filesTouched: z.array(
      z.object({ path: z.string(), chunkSetId: z.string().min(1), createdAt: z.string() }),
    ),
    commandsRun: z.array(
      z.object({ command: z.string(), chunkSetId: z.string().min(1), createdAt: z.string() }),
    ),
    searchCount: z.number().int().nonnegative(),
    fetchCount: z.number().int().nonnegative(),
    // Reserved: no session-scoped decision capture exists yet (spec Non-Goals).
    openDecisions: z.array(z.string()),
  })
  .strict();

export type WorkStateCapsule = z.infer<typeof workStateCapsuleSchema>;

export function capsulePath(storeRoot: string, workspaceKey: string, liveSessionId: string): string {
  return join(storeRoot, "content", workspaceKey, liveSessionId, CAPSULE_FILENAME);
}

export type BuildCapsuleInput = {
  summaries: readonly ChunkSetSummary[];
  intent?: { prompt: string; ts: number } | undefined;
  trigger: string;
  now: () => number;
};

export function buildWorkStateCapsule(input: BuildCapsuleInput): WorkStateCapsule {
  const filesTouched: WorkStateCapsule["filesTouched"] = [];
  const commandsRun: WorkStateCapsule["commandsRun"] = [];
  let searchCount = 0;
  let fetchCount = 0;
  // Newest first: budget trimming later drops from the tail (oldest receipts).
  const ordered = [...input.summaries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seenPaths = new Set<string>();
  for (const s of ordered) {
    if (s.source.kind === "file") {
      if (seenPaths.has(s.source.path)) continue;
      seenPaths.add(s.source.path);
      filesTouched.push({ path: s.source.path, chunkSetId: s.chunkSetId, createdAt: s.createdAt });
    } else if (s.source.kind === "command") {
      commandsRun.push({ command: s.source.command, chunkSetId: s.chunkSetId, createdAt: s.createdAt });
    } else if (s.source.kind === "grep") {
      searchCount += 1;
    } else {
      fetchCount += 1;
    }
  }
  return {
    version: CAPSULE_VERSION,
    capturedAt: new Date(input.now()).toISOString(),
    trigger: input.trigger.slice(0, 32),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
    filesTouched,
    commandsRun,
    searchCount,
    fetchCount,
    openDecisions: [],
  };
}

// Defense in depth over the already-redacted store labels (record-output.ts
// redacts labels before persist; intent-run redacts prompts at capture).
export function redactCapsule(
  capsule: WorkStateCapsule,
  redactString: (s: string) => string,
): WorkStateCapsule {
  return {
    ...capsule,
    ...(capsule.intent !== undefined
      ? { intent: { ...capsule.intent, prompt: redactString(capsule.intent.prompt) } }
      : {}),
    filesTouched: capsule.filesTouched.map((f) => ({ ...f, path: redactString(f.path) })),
    commandsRun: capsule.commandsRun.map((c) => ({ ...c, command: redactString(c.command) })),
    openDecisions: capsule.openDecisions.map(redactString),
  };
}

// Intent files store the full redacted prompt (intent-run's writeIntentAt has
// no length clamp; UserPromptSubmit stdin caps at 256 KB), so an unclamped
// intent line alone could exceed the whole token budget no matter how far
// entry trimming goes. Clamp at render time; the capsule file keeps the full prompt.
const INTENT_RENDER_MAX_CHARS = 500;

function truncateIntent(prompt: string): string {
  if (prompt.length <= INTENT_RENDER_MAX_CHARS) return prompt;
  return `${prompt.slice(0, INTENT_RENDER_MAX_CHARS)}…`;
}

function renderWith(capsule: WorkStateCapsule, maxEntries: number): string {
  const lines: string[] = [
    "MEGA SAVER — WORK ALREADY DONE THIS SESSION (pre-compact snapshot).",
    "Trust these receipts; do not redo them. Expand any receipt with:",
    '  mega output chunk "<chunkSetId>" "<i>"  (or MCP proxy_expand_chunk).',
  ];
  if (capsule.intent !== undefined) lines.push(`Task intent: ${truncateIntent(capsule.intent.prompt)}`);
  const files = capsule.filesTouched.slice(0, maxEntries);
  if (files.length > 0) {
    lines.push(`Files touched (${capsule.filesTouched.length}):`);
    for (const f of files) lines.push(`  - ${f.path}  [${f.chunkSetId}]`);
    const dropped = capsule.filesTouched.length - files.length;
    if (dropped > 0) lines.push(`  … +${dropped} more in store`);
  }
  const commands = capsule.commandsRun.slice(0, maxEntries);
  if (commands.length > 0) {
    lines.push(`Commands run (${capsule.commandsRun.length}):`);
    for (const c of commands) lines.push(`  - ${c.command}  [${c.chunkSetId}]`);
    const dropped = capsule.commandsRun.length - commands.length;
    if (dropped > 0) lines.push(`  … +${dropped} more in store`);
  }
  if (capsule.searchCount > 0 || capsule.fetchCount > 0) {
    lines.push(`Also this session: ${capsule.searchCount} searches, ${capsule.fetchCount} fetches (in store).`);
  }
  if (capsule.openDecisions.length > 0) {
    lines.push("Open decisions:");
    for (const d of capsule.openDecisions) lines.push(`  - ${d}`);
  }
  lines.push("Unchanged re-reads return unchanged-markers pointing at prior chunk-sets; expand instead of re-reading.");
  return lines.join("\n");
}

export function renderCapsuleContext(capsule: WorkStateCapsule): string {
  let maxEntries = 40;
  for (;;) {
    const text = renderWith(capsule, maxEntries);
    if (estimateTokens(text) <= CAPSULE_TOKEN_BUDGET || maxEntries === 0) return text;
    maxEntries = maxEntries > 4 ? Math.floor(maxEntries / 2) : maxEntries - 1;
  }
}
```

- [ ] Run the test file — expect pass.
- [ ] Commit: `feat(cli): work-state capsule model + renderer`

---

### Task 4: PreCompact handler — `mega hooks capsule`

**Files:**
- Create: `apps/cli/src/hooks/capsule-run.ts`
- Create: `apps/cli/src/commands/hooks/capsule.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`
- Test: `apps/cli/test/hooks/capsule-run.test.ts`

**Interfaces:**
```ts
// apps/cli/src/hooks/capsule-run.ts
export type RunCapsuleHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  list: typeof listOverlayChunkSets;
};
export async function runCapsuleHook(input: RunCapsuleHookInput): Promise<WorkStateCapsule | null>;
export async function runCapsuleHookFromProcess(storeFlag?: string): Promise<void>;
// apps/cli/src/commands/hooks/capsule.ts
export const hooksCapsuleCommand: ReturnType<typeof defineCommand>;
```

- [ ] Write the failing test `apps/cli/test/hooks/capsule-run.test.ts` (store fixture mirrors `intent-run.test.ts`; the core is exercised directly, like `buildWarmupHookOutput` — no fd-0 mock needed):

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOverlayChunkSets, saveOverlayChunkSet } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capsulePath, workStateCapsuleSchema } from "../../src/hooks/capsule.js";
import { runCapsuleHook } from "../../src/hooks/capsule-run.js";
import { captureIntent } from "../../src/hooks/intent-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
const sid = "sess-1";
const NOW = Date.parse("2026-08-06T12:00:00.000Z");

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "capsule-run-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

async function seedFileRead(chunkSetId: string, path: string): Promise<void> {
  await saveOverlayChunkSet({
    storeRoot,
    chunkSet: {
      chunkSetId,
      liveSessionId: sid,
      workspaceKey: wk,
      createdAt: "2026-08-06T10:00:00.000Z",
      source: { kind: "file", path },
      rawBytes: 5,
      redacted: true,
      chunks: [{ id: "c0", startLine: 0, endLine: 1, bytes: 5, text: "hello" }],
    },
  });
}

describe("runCapsuleHook", () => {
  it("writes a schema-valid capsule from store state and the intent record", async () => {
    await seedFileRead("cs-1", "src/a.ts");
    captureIntent(storeRoot, { prompt: "fix auth", cwd, session_id: sid }, () => NOW - 60_000);
    const capsule = await runCapsuleHook({
      payload: { session_id: sid, cwd, trigger: "auto", hook_event_name: "PreCompact" },
      storeRoot,
      now: () => NOW,
      list: listOverlayChunkSets,
    });
    expect(capsule).not.toBeNull();
    const onDisk = workStateCapsuleSchema.parse(
      JSON.parse(readFileSync(capsulePath(storeRoot, wk, sid), "utf8")),
    );
    expect(onDisk.filesTouched).toEqual([
      { path: "src/a.ts", chunkSetId: "cs-1", createdAt: "2026-08-06T10:00:00.000Z" },
    ]);
    expect(onDisk.intent).toEqual({ prompt: "fix auth", ts: NOW - 60_000 });
    expect(onDisk.trigger).toBe("auto");
  });

  it("fails open: malformed payload writes nothing and returns null", async () => {
    const capsule = await runCapsuleHook({
      payload: { nope: true },
      storeRoot,
      now: () => NOW,
      list: listOverlayChunkSets,
    });
    expect(capsule).toBeNull();
    expect(existsSync(capsulePath(storeRoot, wk, sid))).toBe(false);
  });

  it("fails open: an unsafe session_id never becomes a path segment", async () => {
    const capsule = await runCapsuleHook({
      payload: { session_id: "../evil", cwd },
      storeRoot,
      now: () => NOW,
      list: listOverlayChunkSets,
    });
    expect(capsule).toBeNull();
  });

  it("fails open: a throwing store listing writes nothing and returns null", async () => {
    const capsule = await runCapsuleHook({
      payload: { session_id: sid, cwd },
      storeRoot,
      now: () => NOW,
      list: async () => {
        throw new Error("store exploded");
      },
    });
    expect(capsule).toBeNull();
    expect(existsSync(capsulePath(storeRoot, wk, sid))).toBe(false);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/capsule-run.test.ts` — expect failure: `capsule-run.js` does not exist.
- [ ] Implement `apps/cli/src/hooks/capsule-run.ts`:

```ts
import { readFileSync } from "node:fs";
import { atomicWriteFile, listOverlayChunkSets } from "@megasaver/content-store";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type WorkStateCapsule,
  buildWorkStateCapsule,
  capsulePath,
  redactCapsule,
} from "./capsule.js";
import { SAFE_SEGMENT, readLatestIntentRecord } from "./intent-run.js";

const preCompactPayloadSchema = z
  .object({ session_id: z.string().min(1), cwd: z.string().min(1), trigger: z.string().optional() })
  .passthrough();

export type RunCapsuleHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  list: typeof listOverlayChunkSets;
};

// Snapshot core, extracted for tests. Contract: NEVER throws — a crashing
// PreCompact hook would stall every compaction (spec: fail-open, never block).
export async function runCapsuleHook(input: RunCapsuleHookInput): Promise<WorkStateCapsule | null> {
  try {
    const parsed = preCompactPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return null;
    const sessionId = parsed.data.session_id;
    if (!SAFE_SEGMENT.test(sessionId)) return null;
    const workspaceKey = encodeWorkspaceKey(parsed.data.cwd);
    const summaries = await input.list({
      storeRoot: input.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
    });
    const intent = readLatestIntentRecord(input.storeRoot, workspaceKey, sessionId);
    const capsule = redactCapsule(
      buildWorkStateCapsule({
        summaries,
        ...(intent !== undefined ? { intent } : {}),
        trigger: parsed.data.trigger ?? "unknown",
        now: input.now,
      }),
      (s) => redact(s).redacted,
    );
    atomicWriteFile(
      capsulePath(input.storeRoot, workspaceKey, sessionId),
      `${JSON.stringify(capsule, null, 2)}\n`,
    );
    return capsule;
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

// Always exits 0, never writes stdout (PreCompact stdout is ignored by Claude
// Code; emitting a decision object could block compaction — never do that).
export async function runCapsuleHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    await runCapsuleHook({ payload, storeRoot, now: () => Date.now(), list: listOverlayChunkSets });
  } catch {
    // Swallow — fail-open.
  }
}
```

- [ ] Implement `apps/cli/src/commands/hooks/capsule.ts` (mirror of `commands/hooks/warmup.ts`):

```ts
import { defineCommand } from "citty";
import { runCapsuleHookFromProcess } from "../../hooks/capsule-run.js";

// The command Claude Code's PreCompact hook invokes. Reads the PreCompact
// payload on stdin and snapshots a work-state capsule to the store. SAFETY:
// ALWAYS exits 0; writes no stdout. Wired by `mega hooks install`.
export const hooksCapsuleCommand = defineCommand({
  meta: {
    name: "capsule",
    description: "Internal: snapshot a work-state capsule for a PreCompact hook (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runCapsuleHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
```

- [ ] Register in `apps/cli/src/commands/hooks/index.ts`: import `hooksCapsuleCommand`, add `export { hooksCapsuleCommand } from "./capsule.js";`, add `capsule: hooksCapsuleCommand` to `hooksCommand.subCommands`.
- [ ] Run the test file — expect pass.
- [ ] Commit: `feat(cli): PreCompact capsule hook`

---

### Task 5: post-compact recap handler — `mega hooks recap`

**Files:**
- Create: `apps/cli/src/hooks/recap-run.ts`
- Create: `apps/cli/src/commands/hooks/recap.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`
- Test: `apps/cli/test/hooks/recap-run.test.ts`

**Interfaces:**
```ts
// apps/cli/src/hooks/recap-run.ts
export const RECAP_FALLBACK_WINDOW_MS = 15 * 60_000;
export function loadCapsule(storeRoot: string, workspaceKey: string, liveSessionId: string, now: () => number): WorkStateCapsule | null;
export function buildRecapHookOutput(input: { payload: unknown; storeRoot: string; now: () => number }): string;
export function renderRecapStdout(text: string): string;
export async function runRecapHookFromProcess(storeFlag?: string): Promise<void>;
// apps/cli/src/commands/hooks/recap.ts
export const hooksRecapCommand: ReturnType<typeof defineCommand>;
```

- [ ] Write the failing test `apps/cli/test/hooks/recap-run.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAPSULE_VERSION, type WorkStateCapsule, capsulePath } from "../../src/hooks/capsule.js";
import {
  RECAP_FALLBACK_WINDOW_MS,
  buildRecapHookOutput,
  renderRecapStdout,
} from "../../src/hooks/recap-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function capsule(capturedAt: string): WorkStateCapsule {
  return {
    version: CAPSULE_VERSION,
    capturedAt,
    trigger: "auto",
    intent: { prompt: "fix auth", ts: NOW - 60_000 },
    filesTouched: [{ path: "src/a.ts", chunkSetId: "cs-abc", createdAt: capturedAt }],
    commandsRun: [{ command: "pnpm test", chunkSetId: "cs-cmd", createdAt: capturedAt }],
    searchCount: 0,
    fetchCount: 0,
    openDecisions: [],
  };
}

function writeCapsule(sessionId: string, value: WorkStateCapsule): void {
  const path = capsulePath(storeRoot, wk, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "recap-run-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("buildRecapHookOutput", () => {
  it("injects the capsule for source=compact with lossless chunk pointers", () => {
    writeCapsule("sess-1", capsule(new Date(NOW - 30_000).toISOString()));
    const text = buildRecapHookOutput({
      payload: { session_id: "sess-1", cwd, source: "compact" },
      storeRoot,
      now: () => NOW,
    });
    expect(text).toContain("src/a.ts");
    expect(text).toContain("cs-abc");
    expect(text).toContain("fix auth");
  });

  it.each(["startup", "resume", "clear"])("emits nothing for source=%s", (source) => {
    writeCapsule("sess-1", capsule(new Date(NOW - 30_000).toISOString()));
    expect(
      buildRecapHookOutput({ payload: { session_id: "sess-1", cwd, source }, storeRoot, now: () => NOW }),
    ).toBe("");
  });

  it("emits nothing when no capsule exists", () => {
    expect(
      buildRecapHookOutput({ payload: { session_id: "sess-1", cwd, source: "compact" }, storeRoot, now: () => NOW }),
    ).toBe("");
  });

  it("falls back to a fresh sibling-session capsule but ignores stale ones", () => {
    writeCapsule("other-session", capsule(new Date(NOW - 60_000).toISOString()));
    const hit = buildRecapHookOutput({
      payload: { session_id: "sess-new", cwd, source: "compact" },
      storeRoot,
      now: () => NOW,
    });
    expect(hit).toContain("cs-abc");
    const stale = buildRecapHookOutput({
      payload: { session_id: "sess-new", cwd, source: "compact" },
      storeRoot,
      now: () => NOW + RECAP_FALLBACK_WINDOW_MS + 60_000,
    });
    expect(stale).toBe("");
  });
});

describe("renderRecapStdout", () => {
  it("wraps text in the SessionStart additionalContext envelope", () => {
    expect(JSON.parse(renderRecapStdout("recap text"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "recap text" },
    });
  });

  it("returns empty string for empty text (no injection)", () => {
    expect(renderRecapStdout("")).toBe("");
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/recap-run.test.ts` — expect failure: `recap-run.js` does not exist.
- [ ] Implement `apps/cli/src/hooks/recap-run.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CAPSULE_FILENAME } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type WorkStateCapsule,
  capsulePath,
  renderCapsuleContext,
  workStateCapsuleSchema,
} from "./capsule.js";
import { SAFE_SEGMENT } from "./intent-run.js";

const sessionStartPayloadSchema = z
  .object({ session_id: z.string().min(1), cwd: z.string().min(1), source: z.string() })
  .passthrough();

export const RECAP_FALLBACK_WINDOW_MS = 15 * 60_000;

function readCapsuleAt(path: string): WorkStateCapsule | null {
  try {
    const parsed = workStateCapsuleSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Exact session first; else the newest capsule in this workspace captured
// within the window (ASSUMPTION: post-compact session_id may differ — spec
// Error handling; the window bounds wrong-session injection).
export function loadCapsule(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
  now: () => number,
): WorkStateCapsule | null {
  if (SAFE_SEGMENT.test(liveSessionId)) {
    const exact = readCapsuleAt(capsulePath(storeRoot, workspaceKey, liveSessionId));
    if (exact !== null) return exact;
  }
  let dirs: string[];
  try {
    dirs = readdirSync(join(storeRoot, "content", workspaceKey));
  } catch {
    return null;
  }
  let best: WorkStateCapsule | null = null;
  for (const dir of dirs) {
    const candidate = readCapsuleAt(join(storeRoot, "content", workspaceKey, dir, CAPSULE_FILENAME));
    if (candidate === null) continue;
    const age = now() - Date.parse(candidate.capturedAt);
    if (Number.isNaN(age) || age < 0 || age > RECAP_FALLBACK_WINDOW_MS) continue;
    if (best === null || candidate.capturedAt > best.capturedAt) best = candidate;
  }
  return best;
}

// Pure-ish core, extracted for tests. Contract: NEVER throws — every failure
// returns "" so the SessionStart hook can never block a session.
export function buildRecapHookOutput(input: {
  payload: unknown;
  storeRoot: string;
  now: () => number;
}): string {
  try {
    const parsed = sessionStartPayloadSchema.safeParse(input.payload);
    if (!parsed.success || parsed.data.source !== "compact") return "";
    const workspaceKey = encodeWorkspaceKey(parsed.data.cwd);
    const found = loadCapsule(input.storeRoot, workspaceKey, parsed.data.session_id, input.now);
    if (found === null) return "";
    return renderCapsuleContext(found);
  } catch {
    return "";
  }
}

export function renderRecapStdout(text: string): string {
  if (text === "") return "";
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  });
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0; empty stdout on any failure ("no output" = no injection).
export async function runRecapHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const s = renderRecapStdout(buildRecapHookOutput({ payload, storeRoot, now: () => Date.now() }));
    if (s !== "") process.stdout.write(s);
  } catch {
    // Swallow — fail-open.
  }
}
```

- [ ] Implement `apps/cli/src/commands/hooks/recap.ts` (mirror of `commands/hooks/warmup.ts`):

```ts
import { defineCommand } from "citty";
import { runRecapHookFromProcess } from "../../hooks/recap-run.js";

// The command Claude Code's SessionStart hook invokes after compaction. Emits
// the work-state recap as additionalContext only for source === "compact".
// SAFETY: ALWAYS exits 0; prints nothing on any error or non-compact source.
export const hooksRecapCommand = defineCommand({
  meta: {
    name: "recap",
    description: "Internal: print the post-compact work-state recap for a SessionStart hook (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runRecapHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
```

- [ ] Register in `apps/cli/src/commands/hooks/index.ts`: import + export `hooksRecapCommand`, add `recap: hooksRecapCommand` to `hooksCommand.subCommands`.
- [ ] Run the test file — expect pass.
- [ ] Commit: `feat(cli): post-compact recap hook`

---

### Task 6: connector — PreCompact adder + recap entry + install wiring

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Modify: `apps/cli/src/commands/hooks/uninstall.ts` (pass-through of the widened result only if it surfaces per-hook fields; otherwise untouched — `uninstallClaudeCodeHook` handles removal internally)
- Test: `apps/cli/test/hooks/install.test.ts` (extend — connector functions are already tested from here, see its existing `addPreToolUseHook` describe blocks)

**Interfaces:**
```ts
// packages/connectors/claude-code/src/hook-settings.ts
export const CAPSULE_HOOK_COMMAND = "mega hooks capsule";
export const RECAP_HOOK_COMMAND = "mega hooks recap";
export function hasPreCompactHook(settings: unknown, command: string): boolean;
export function addPreCompactHook(settings: unknown, command: string): SettingsObject; // SettingsObject stays module-private; public return type mirrors addSessionStartHook
export function removePreCompactHook(settings: unknown, command: string): SettingsObject;
// buildHookCommand subcommand union gains "capsule" | "recap"
// InstallClaudeCodeHookInput gains compactionGuard?: boolean (default true)
// ClaudeCodeHookStatus gains capsuleInstalled: boolean; recapInstalled: boolean
```

- [ ] Write the failing tests — extend `apps/cli/test/hooks/install.test.ts` with a new describe block (same file, same import style as its existing `addPreToolUseHook` block):

```ts
import {
  CAPSULE_HOOK_COMMAND,
  RECAP_HOOK_COMMAND,
  addPreCompactHook,
  addSessionStartHook,
  hasPreCompactHook,
  hasSessionStartHook,
  removePreCompactHook,
} from "@megasaver/connector-claude-code";

describe("addPreCompactHook (pure, idempotent)", () => {
  it("adds a matcherless PreCompact entry to empty settings", () => {
    const next = addPreCompactHook({}, CAPSULE_HOOK_COMMAND) as {
      hooks: { PreCompact: { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[] };
    };
    expect(hasPreCompactHook(next, CAPSULE_HOOK_COMMAND)).toBe(true);
    const entry = next.hooks.PreCompact[0];
    expect(entry?.matcher).toBeUndefined();
    expect(entry?.hooks[0]).toEqual({ type: "command", command: CAPSULE_HOOK_COMMAND, timeout: 10 });
  });

  it("is idempotent — re-adding does not duplicate the entry", () => {
    const once = addPreCompactHook({}, CAPSULE_HOOK_COMMAND);
    const twice = addPreCompactHook(once, CAPSULE_HOOK_COMMAND);
    expect((twice as { hooks: { PreCompact: unknown[] } }).hooks.PreCompact).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it("removal leaves no residue on otherwise-empty settings", () => {
    const removed = removePreCompactHook(addPreCompactHook({}, CAPSULE_HOOK_COMMAND), CAPSULE_HOOK_COMMAND);
    expect(removed).toEqual({});
  });
});

describe("recap as a second SessionStart entry", () => {
  it("coexists with the warmup entry, keyed by subcommand", () => {
    const withWarmup = addSessionStartHook({}, "mega hooks warmup");
    const withBoth = addSessionStartHook(withWarmup, RECAP_HOOK_COMMAND);
    expect((withBoth as { hooks: { SessionStart: unknown[] } }).hooks.SessionStart).toHaveLength(2);
    expect(hasSessionStartHook(withBoth, "mega hooks warmup")).toBe(true);
    expect(hasSessionStartHook(withBoth, RECAP_HOOK_COMMAND)).toBe(true);
  });
});

describe("installClaudeCodeHook compaction guard wiring", () => {
  it("installs capsule + recap by default and removes them on uninstall", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-guard-"));
    const settingsPath = join(dir, "settings.json");
    try {
      installClaudeCodeHook({ settingsPath });
      const status = readClaudeCodeHookStatus({ settingsPath });
      expect(status.capsuleInstalled).toBe(true);
      expect(status.recapInstalled).toBe(true);
      uninstallClaudeCodeHook({ settingsPath });
      const after = readClaudeCodeHookStatus({ settingsPath });
      expect(after.capsuleInstalled).toBe(false);
      expect(after.recapInstalled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips both when compactionGuard is false", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-noguard-"));
    const settingsPath = join(dir, "settings.json");
    try {
      installClaudeCodeHook({ settingsPath, compactionGuard: false });
      const status = readClaudeCodeHookStatus({ settingsPath });
      expect(status.capsuleInstalled).toBe(false);
      expect(status.recapInstalled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

  (`installClaudeCodeHook`, `readClaudeCodeHookStatus`, `mkdtempSync`, `rmSync`, `tmpdir`, `join` are already imported at the top of `install.test.ts`; add `uninstallClaudeCodeHook` and the new symbols to those imports.)
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts` — expect failure: new exports missing.
- [ ] Implement in `packages/connectors/claude-code/src/hook-settings.ts`:
  - Constants beside `WARMUP_HOOK_COMMAND` (L18): `export const CAPSULE_HOOK_COMMAND = "mega hooks capsule";` and `export const RECAP_HOOK_COMMAND = "mega hooks recap";`
  - `SettingsObject.hooks` (L206-212) gains `PreCompact?: unknown;`; `pruneHooks`'s `key` union (L324) gains `"PreCompact"`.
  - `buildHookCommand` subcommand union (L28-ish) gains `"capsule" | "recap"` (both take the `--store` suffix automatically — only `"log"` is excluded).
  - The PreCompact trio, an exact structural mirror of `hasSessionStartHook` / `addSessionStartHook` / `removeSessionStartHook` (L413-447) with `SessionStart` → `PreCompact` and this comment on the matcherless push: `// No matcher: PreCompact matchers filter on the trigger value; omitted = both "auto" and "manual".`
  - `InstallClaudeCodeHookInput` (L524-532) gains `compactionGuard?: boolean;`. In `installClaudeCodeHook` (after the guard block, L550-552):

```ts
  if (input.compactionGuard !== false) {
    next = addPreCompactHook(next, buildHookCommand("capsule", cfg));
    next = addSessionStartHook(next, buildHookCommand("recap", cfg));
  }
```

  - `uninstallClaudeCodeHook`: add `!hasPreCompactHook(existing, CAPSULE_HOOK_COMMAND) && !hasSessionStartHook(existing, RECAP_HOOK_COMMAND)` to the no-op conjunction (L574-581) and `next = removePreCompactHook(next, CAPSULE_HOOK_COMMAND); next = removeSessionStartHook(next, RECAP_HOOK_COMMAND);` to the removal chain (L584-589).
  - `ClaudeCodeHookStatus` (L594-602) gains `capsuleInstalled: boolean; recapInstalled: boolean;`; `readClaudeCodeHookStatus` computes them via `hasPreCompactHook(settings, CAPSULE_HOOK_COMMAND)` / `hasSessionStartHook(settings, RECAP_HOOK_COMMAND)` and the catch-branch object (L610-618) gains both as `false`.
  - Export the new symbols from the connector's `src/index.ts` alongside the existing hook-settings exports.
- [ ] Wire the CLI flag in `apps/cli/src/commands/hooks/install.ts`: `RunHooksInstallInput` gains `compactionGuard?: boolean`; pass `...(input.compactionGuard !== undefined ? { compactionGuard: input.compactionGuard } : {})` into `installClaudeCodeHook` (beside the existing `warmup`/`guard` spreads, L65-67); add the citty arg `"compaction-guard": { type: "boolean", default: true, description: "Install the PreCompact capsule + post-compact recap hooks (--no-compaction-guard to skip)." }` and pass `compactionGuard: args["compaction-guard"] !== false` in `run` (beside `cacheAdvice`, L149-151); extend the non-JSON success message (L83) to mention `PreCompact capsule + SessionStart recap`.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/hooks/uninstall.test.ts test/hooks/status.test.ts` — expect pass (uninstall/status suites prove no regression in the widened result shape).
- [ ] Commit: `feat(connector): install compaction guard hooks`

---

### Task 7: verification, changesets, wiki

**Files:**
- Create: `.changeset/compaction-guard.md`
- Create: `wiki/concepts/compaction-guard.md`
- Modify: `wiki/index.md`, `wiki/log.md`, `wiki/entities/cli.md`, `wiki/entities/connectors-claude-code.md`

- [ ] Run `pnpm verify` from the repo root — lint + typecheck + full vitest must be green before any done-claim (§9.4).
- [ ] Feature smoke evidence (§9.5, capture the terminal session): pipe a simulated PreCompact payload into the built CLI, then a simulated SessionStart payload, and show the envelope:

```bash
echo '{"session_id":"smoke-1","cwd":"'$PWD'","trigger":"manual","hook_event_name":"PreCompact"}' | node apps/cli/dist/cli.js hooks capsule --store /tmp/guard-smoke
echo '{"session_id":"smoke-1","cwd":"'$PWD'","source":"compact"}' | node apps/cli/dist/cli.js hooks recap --store /tmp/guard-smoke
```

  Expected: first command silent, capsule file exists under the store; second ALWAYS prints the `hookSpecificOutput` envelope once the capsule write succeeded — a valid PreCompact payload with no captured chunk-sets and no intent still writes a minimal capsule (Task 4), and the renderer always emits its fixed header/trailer lines (Task 3), so there is no "nothing" branch in this sequence. Seed one `Read` through the saver hook before the PreCompact payload so the envelope shows a representative receipt line.
- [ ] Write `.changeset/compaction-guard.md`:

```md
---
"@megasaver/content-store": minor
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
---

Compaction Guard: PreCompact work-state capsule snapshot (`mega hooks capsule`), post-compact recap injection (`mega hooks recap`), `listOverlayChunkSets` + reserved `work-state-capsule.json` sibling, and `installClaudeCodeHook({ compactionGuard })` wiring.
```

- [ ] Write `wiki/concepts/compaction-guard.md` (schema per `wiki/CLAUDE.md`: frontmatter with title/tags/sources/status/created/updated; body ≤50 lines): problem (P2, upstream #75759/#57486), mechanism (PreCompact snapshot → SessionStart source=compact injection), the two locked keys (workspaceKey/session_id; reserved sibling filename), the session-id-continuity ASSUMPTION + fallback window, pointer-not-paraphrase posture, and source citations to the spec and to `packages/content-store/src/store.ts` / `apps/cli/src/hooks/capsule-run.ts`.
- [ ] Update `wiki/index.md` (concepts list + quick-links row "How does the compaction guard work?"), `wiki/entities/cli.md` (`mega hooks {capsule,recap}`), `wiki/entities/connectors-claude-code.md` (PreCompact adder + `compactionGuard` install flag), and append a timestamped entry to `wiki/log.md`.
- [ ] Commit: `docs(wiki): record compaction guard feature`
- [ ] Request review per §9.6: `code-reviewer` pass AND `critic` pass (risk HIGH), fresh contexts, then `verifier` with the smoke capture.

---

## Self-review

- **Coverage:** every spec component maps to a task — C1→Task 1, C6→Task 2, C2→Task 3, C3→Task 4, C4→Task 5, C5→Task 6, DoD/process→Task 7. Both hook payload boundaries are Zod-guarded and both fail-open contracts are pinned by tests (malformed payload, throwing store, unsafe session id, non-compact source, missing capsule).
- **Placeholder scan:** no "similar to Task N", no TODO/ellipsis stubs in code blocks; every referenced symbol is either defined in a task or cited to its real file (`SAFE_SEGMENT` + `intentFileSchema` + `sessionIntentFilePath`/`intentFilePath` in `apps/cli/src/hooks/intent-run.ts`; `assertSafeSegment` in `packages/content-store/src/paths.ts`, added to store.ts's `./paths.js` import by Task 1; `isErrno`/`overlayChunkSetSchema`/`ContentStoreError` in `packages/content-store/src/store.ts`; `estimateTokens` in `@megasaver/output-filter`; `redact` in `@megasaver/policy`; `encodeWorkspaceKey` in `@megasaver/shared`; `resolveStorePath`/`readStoreEnv` in `apps/cli/src/store.ts`; `repairEntry`/`stripCommand`/`pruneHooks`/`timeoutFor` in `hook-settings.ts`).
- **Type consistency:** `ChunkSetSummary.source` is the discriminated union from `chunk-set.ts`, matched exhaustively in `buildWorkStateCapsule`; optional fields use conditional spreads (repo `exactOptionalPropertyTypes: true`); `atomicWriteFile(filePath: string, content: string): void` matches `packages/content-store/src/atomic-write.ts` L21.
- **No timing-tight tests:** all clocks are injected `now: () => number`; the fallback-window test compares fixed timestamps, no sleeps, no real timers.
