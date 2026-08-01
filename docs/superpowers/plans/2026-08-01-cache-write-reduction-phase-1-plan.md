# Cache-Write Reduction Phase 1 — Stable Task Kickoff Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit one measured-token, byte-stable, task-aware context pack on the first Claude Code user prompt of a session, so the agent begins with ranked project evidence instead of blind exploration.

**Architecture:** Keep all Claude Code hook behaviour in `apps/cli`. A pure renderer converts existing context-pruner candidate metadata plus Code-Truth-verified memories into compact text; a small owner-only per-session store makes the first result immutable for the session and suppresses later emissions. The existing `hooks intent` command becomes asynchronous, records the normal redacted intent first, then returns newly assembled `additionalContext` only once without ever blocking a prompt.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, existing `@megasaver/context-pruner`, `@megasaver/indexer`, `@megasaver/core`, `@megasaver/output-filter` real tokenizer, and `@megasaver/stats` JSONL event helpers.

## Global Constraints

- The pack cap is **2,000 real `countTokens` tokens**; a tokenizer failure or 500 ms deadline yields no pack, never a bytes/4 substitute.
- Persist only the already-redacted task, rendered pack, SHA-256 task hash, measured token count, and timestamp under `stats/<workspace>/task-pack/<safe-session>.json`; directories are `0700`, files `0600`, and writes are temp-plus-rename.
- The first successful pack for `(workspaceKey, sessionId)` is emitted once. It is never recomputed, updated, or injected again in that session.
- A memory must be recallable, non-stale, and have `lastVerified.result` equal to `verified` or `healed` before it is rendered. Source bodies never enter the pack.
- Malformed payload, absent/unsafe session id, no matching project/index, store error, timeout, or any exception returns empty stdout and exit `0`.
- Task-kickoff token count is an injected-context **cost event**, not a savings event and never contributes to a savings headline.
- Do not use or extend the existing `packages/core/src/warmstart-pack.ts` scaffold; it is not a verified task pack and has no hook/storage contract. Do not add agent-specific logic to Core.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/cli/src/hooks/task-kickoff-pack.ts` | Pure deterministic renderer from verified memories and ranked `ContextPack` candidates. |
| `apps/cli/src/hooks/task-kickoff-store.ts` | Safe-session validation, atomic owner-only task-pack cache read/write. |
| `apps/cli/src/hooks/task-kickoff.ts` | Hook orchestration: parse intent, resolve project/index, deadline, cache-once decision, and output envelope. |
| `apps/cli/src/hooks/intent-run.ts` | Retain redacted intent persistence; delegate UserPromptSubmit output to the task-kickoff orchestrator. |
| `apps/cli/src/commands/context/shared.ts` | Export a no-CLI-output helper that builds a `ContextPack` from already-resolved project/registry inputs. |
| `packages/stats/src/task-kickoff-event.ts` | Strict cost-event schema and append/read helpers for task-pack injections. |
| `packages/stats/src/index.ts` | Public export of the task-kickoff event surface. |
| `apps/cli/src/hooks/gc.ts` | Sweep expired task-pack files on the existing daily hook-GC cadence. |
| `apps/cli/test/hooks/task-kickoff-pack.test.ts` | Renderer token, verification, deterministic, and no-source-body tests. |
| `apps/cli/test/hooks/task-kickoff-store.test.ts` | Store validation, permissions, atomic-cache, and corrupt-state tests. |
| `apps/cli/test/hooks/task-kickoff.test.ts` | First-prompt/cache/deadline/fail-open hook orchestration tests. |
| `apps/cli/test/hooks/intent-run.test.ts` | Process-level intent hook regression coverage. |
| `packages/stats/test/task-kickoff-event.test.ts` | Event schema and append/read tests. |

## Task 1: Pure, measured task-pack renderer

**Files:**

- Create: `apps/cli/src/hooks/task-kickoff-pack.ts`
- Create: `apps/cli/test/hooks/task-kickoff-pack.test.ts`

**Interfaces:**

- Consumes: `ContextPack` from `@megasaver/context-pruner`, `MemoryEntry` and `isRecallable` from `@megasaver/core`, and `countTokens` from `@megasaver/output-filter`.
- Produces:

```ts
export const TASK_KICKOFF_TOKEN_CAP = 2_000;
export const TASK_KICKOFF_MAX_MEMORIES = 6;
export const TASK_KICKOFF_MAX_FILES = 12;

export type TaskKickoffPackInput = {
  projectName: string;
  task: string;
  now: string;
  memories: readonly MemoryEntry[];
  contextPack: ContextPack;
  count: (text: string) => Promise<number>;
};

export type TaskKickoffPack = { text: string; tokenCount: number };

export async function renderTaskKickoffPack(
  input: TaskKickoffPackInput,
): Promise<TaskKickoffPack | null>;
```

- [ ] **Step 1: Write the failing renderer tests**

Create fixtures with one anchored `lastVerified: { result: "verified", ... }` decision, one `healed` rule memory, one unanchored memory, one contradicted memory, and an included `ContextPack` with `src/auth.ts:10-32` and `test/auth.test.ts:4-27`. Add these assertions:

```ts
it("renders only code-truth-verified, current memories and candidate metadata", async () => {
  const pack = await renderTaskKickoffPack({
    projectName: "demo",
    task: "repair auth",
    now: "2026-08-01T00:00:00.000Z",
    memories: [verified, healed, unanchored, contradicted, stale],
    contextPack,
    count: async (text) => text.split(/\s+/).length,
  });
  expect(pack?.text).toContain("[decision] use session store");
  expect(pack?.text).toContain("src/auth.ts:10-32");
  expect(pack?.text).not.toContain(unanchored.title);
  expect(pack?.text).not.toContain(contradicted.title);
  expect(pack?.text).not.toContain(stale.title);
  expect(pack?.text).not.toContain("function secretImplementation");
});

it("is byte-stable and never exceeds the measured hard cap", async () => {
  const count = async (text: string) => text.length;
  const a = await renderTaskKickoffPack({ ...largeInput, count });
  const b = await renderTaskKickoffPack({ ...largeInput, count });
  expect(a).toEqual(b);
  expect(a?.tokenCount).toBeLessThanOrEqual(TASK_KICKOFF_TOKEN_CAP);
});

it("returns null when counting fails", async () => {
  await expect(
    renderTaskKickoffPack({ ...input, count: async () => Promise.reject(new Error("encoder")) }),
  ).resolves.toBeNull();
});
```

- [ ] **Step 2: Run the renderer tests to verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-pack.test.ts`

Expected: FAIL because `task-kickoff-pack.js` does not exist.

- [ ] **Step 3: Implement the deterministic renderer**

Implement the exported constants and types above. Use these exact selection and formatting rules:

```ts
function eligibleMemory(memory: MemoryEntry, now: string): boolean {
  return (
    isRecallable(memory, now) &&
    !memory.stale &&
    (memory.lastVerified?.result === "verified" || memory.lastVerified?.result === "healed")
  );
}

function memoryLine(memory: MemoryEntry): string {
  const firstSentence = memory.content.split(/(?<=[.!?])\s/)[0] ?? memory.content;
  const summary = firstSentence.slice(0, 160);
  return `- [${memory.type}] ${memory.title} — ${summary}`;
}

function candidateLine(candidate: ContextPack["included"][number]): string {
  const name = candidate.name === undefined ? "" : ` ${candidate.name}`;
  return `- ${candidate.filePath}:${candidate.startLine}-${candidate.endLine}${name} (${candidate.reasons[0]})`;
}
```

Start from these stable headings:

```ts
const lines = [
  `# Task kickoff — ${input.projectName}`,
  `Task: ${input.task.trim().slice(0, 320)}`,
  "## Verified project memory",
  ...verifiedMemoryLines,
  "## Candidate files",
  ...candidateLines,
];
```

Build the result one line at a time. For each candidate joined string call
`await input.count(candidate)`; retain it only when its measured count is at
most `TASK_KICKOFF_TOKEN_CAP`. If the header alone exceeds the cap, return
`null`. Sort memories by `id` and candidates by `filePath`, `startLine`, then
`blockId` before slicing so identical inputs always render identically.

- [ ] **Step 4: Run the renderer tests to verify green**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-pack.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the renderer slice**

```bash
git add apps/cli/src/hooks/task-kickoff-pack.ts apps/cli/test/hooks/task-kickoff-pack.test.ts
git commit -m "feat(cli): render task kickoff packs"
```

## Task 2: Owner-only session cache

**Files:**

- Create: `apps/cli/src/hooks/task-kickoff-store.ts`
- Create: `apps/cli/test/hooks/task-kickoff-store.test.ts`

**Interfaces:**

```ts
export type StoredTaskKickoffPack = {
  taskHash: string;
  text: string;
  tokenCount: number;
  createdAt: number;
};
export function isSafeHookSessionId(value: string): boolean;
export function taskKickoffPackPath(storeRoot: string, workspaceKey: string, sessionId: string): string;
export function readTaskKickoffPack(
  storeRoot: string, workspaceKey: string, sessionId: string,
): StoredTaskKickoffPack | undefined;
export function writeTaskKickoffPack(
  storeRoot: string, workspaceKey: string, sessionId: string, pack: StoredTaskKickoffPack,
): void;
```

- [ ] **Step 1: Write the failing store tests**

Cover all of these exact cases:

```ts
it("writes and reads one safe session cache under stats/<workspace>/task-pack", () => {
  writeTaskKickoffPack(root, workspace, safeSession, stored);
  expect(readTaskKickoffPack(root, workspace, safeSession)).toEqual(stored);
});

it("treats malformed and unsafe-session state as absent while preserving one session emission guard", () => {
  expect(readTaskKickoffPack(root, workspace, "../../escape")).toBeUndefined();
  writeFileSync(taskKickoffPackPath(root, workspace, safeSession), "{ bad json");
  expect(readTaskKickoffPack(root, workspace, safeSession)).toBeUndefined();
  writeTaskKickoffPack(root, workspace, safeSession, { ...stored, createdAt: 1 });
  expect(readTaskKickoffPack(root, workspace, safeSession)).toEqual({ ...stored, createdAt: 1 });
});

it.skipIf(process.platform === "win32")("uses owner-only directory and file permissions", () => {
  writeTaskKickoffPack(root, workspace, safeSession, stored);
  expect(statSync(dirname(taskKickoffPackPath(root, workspace, safeSession))).mode & 0o777).toBe(0o700);
  expect(statSync(taskKickoffPackPath(root, workspace, safeSession)).mode & 0o777).toBe(0o600);
});
```

- [ ] **Step 2: Run the store test to verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-store.test.ts`

Expected: FAIL because `task-kickoff-store.js` does not exist.

- [ ] **Step 3: Implement strict cache persistence**

Use this schema and exact file layout:

```ts
const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const storedTaskKickoffPackSchema = z.object({
  taskHash: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().min(1),
  tokenCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
}).strict();

export function taskKickoffPackPath(root: string, workspace: string, session: string): string {
  return join(root, "stats", workspace, "task-pack", `${session}.json`);
}
```

Reject an unsafe session before constructing a path. `readTaskKickoffPack`
must `safeParse` and swallow every read/parse failure. It deliberately does
not expire a valid row: the row is the one-emission guard for its session and
the existing daily GC owns 30-day retention. `writeTaskKickoffPack`
creates and chmods its parent directory to `0700`, writes JSON plus newline to
`.<randomUUID()>.tmp` with mode `0600`, and renames it to the target. On a
write error, remove only that generated tmp pathname then rethrow; callers own
the fail-open decision.

- [ ] **Step 4: Run the store test to verify green**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the store slice**

```bash
git add apps/cli/src/hooks/task-kickoff-store.ts apps/cli/test/hooks/task-kickoff-store.test.ts
git commit -m "feat(cli): cache task kickoff packs"
```

## Task 3: Dedicated cost event

**Files:**

- Create: `packages/stats/src/task-kickoff-event.ts`
- Modify: `packages/stats/src/index.ts`
- Create: `packages/stats/test/task-kickoff-event.test.ts`

**Interfaces:**

```ts
export const taskKickoffEventSchema = z.object({
  id: z.string().uuid(),
  workspaceKey: z.string().min(1),
  sessionId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  tokenCount: z.number().int().nonnegative(),
}).strict();
export type TaskKickoffEvent = z.infer<typeof taskKickoffEventSchema>;
export function taskKickoffEventPath(storeRoot: string, workspaceKey: string): string;
export function appendTaskKickoffEvent(store: { root: string }, event: TaskKickoffEvent): void;
export function readTaskKickoffEvents(store: { root: string }, workspaceKey: string): TaskKickoffEvent[];
```

- [ ] **Step 1: Write failing stats tests**

Use a valid UUID fixture and assert an event parses, a negative token count is
rejected, an unknown field is rejected, two valid rows read back in append
order, and a corrupt JSONL line is skipped rather than crashing the reader.

- [ ] **Step 2: Run the stats test to verify red**

Run: `pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts`

Expected: FAIL because `task-kickoff-event.js` is not exported.

- [ ] **Step 3: Implement the event family using existing append-line helpers**

Follow `warm-start-event.ts`'s directory and JSONL pattern exactly, but use
the distinct path `stats/<workspaceKey>/task-kickoff.jsonl`. Parse each input
row with `taskKickoffEventSchema.safeParse`, skip invalid rows on read, and do
not import CLI code into stats. Add `export * from "./task-kickoff-event.js";`
to `packages/stats/src/index.ts`.

- [ ] **Step 4: Run the stats test to verify green**

Run: `pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the event slice**

```bash
git add packages/stats/src/task-kickoff-event.ts packages/stats/src/index.ts packages/stats/test/task-kickoff-event.test.ts
git commit -m "feat(stats): record task kickoff costs"
```

## Task 4: Build hook inputs from existing project/index seams

**Files:**

- Modify: `apps/cli/src/commands/context/shared.ts`
- Create: `apps/cli/src/hooks/task-kickoff.ts`
- Create: `apps/cli/test/hooks/task-kickoff.test.ts`

**Interfaces:**

Add this helper beside `loadPack` so the hook does not imitate CLI argument
parsing or write CLI error text:

```ts
export type BuildProjectContextPackInput = {
  project: Project;
  registry: CoreRegistry;
  rootDir: string;
  task: string;
};
export async function buildProjectContextPack(
  input: BuildProjectContextPackInput,
): Promise<ContextPack | null>;
```

The helper uses `readBlocks(resolveIndexPaths(input.rootDir, input.project.id))`,
`input.registry.listMemoryEntries(input.project.id)`,
`taskScopedMemoryFiles`, `approvedMemoryFiles`, `staleMemoryFiles`, and
`readCoChangeLog(input.project.rootPath)` exactly as `loadPack` already does.
It invokes `buildContextPack` with `task: input.task`, empty changed/failing
lists, `limit: 12`, and `maxTokens: 2_000`; it returns `null` for missing index
or any thrown dependency rather than emitting a CLI message.

`task-kickoff.ts` exports:

```ts
export type BuildTaskKickoffHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  deadlineMs?: number;
  count?: (text: string) => Promise<number>;
  newId?: () => string;
};
export async function buildTaskKickoffHookOutput(
  input: BuildTaskKickoffHookInput,
): Promise<string>;
```

- [ ] **Step 1: Write failing helper and hook tests**

Add a `buildProjectContextPack` test with a temporary indexed project fixture
that asserts `included` contains only metadata. For the hook, inject a safe
payload `{ prompt: "repair auth", cwd, session_id }` and assert:

```ts
it("returns one UserPromptSubmit additionalContext envelope and suppresses later prompts", async () => {
  const first = await buildTaskKickoffHookOutput(input);
  const second = await buildTaskKickoffHookOutput({ ...input, payload: { ...payload, prompt: "another prompt" } });
  expect(JSON.parse(first).hookSpecificOutput).toMatchObject({ hookEventName: "UserPromptSubmit" });
  expect(second).toBe("");
});

it("returns empty output for unsafe session, absent project/index, renderer error, or deadline", async () => {
  await expect(buildTaskKickoffHookOutput({ ...input, payload: { ...payload, session_id: "../../x" } })).resolves.toBe("");
  await expect(buildTaskKickoffHookOutput({ ...input, deadlineMs: 0 })).resolves.toBe("");
});
```

Also assert the written `task-kickoff.jsonl` event's `tokenCount` equals the
stored pack's measured value, and that the second emission creates no second
event.

- [ ] **Step 2: Run the helper and hook tests to verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts`

Expected: FAIL because `buildProjectContextPack` and `task-kickoff.js` do not
exist.

- [ ] **Step 3: Implement the hook orchestration**

Parse the payload with a strict local Zod shape containing `prompt`, `cwd`, and
`session_id`. Trim the prompt, reject empty/unsafe inputs, call
`ensureStoreReady`, and resolve the project with existing `findProjectByCwd`.
Before any assembly, call `readTaskKickoffPack`; on a valid hit return `""`.
The cache is an emission guard, not a source of repeated prompt context. For a
miss, emit exactly:

```ts
JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: cached.text,
  },
});
```

For a miss, race the complete project-pack + renderer promise against a timeout
promise that resolves `null`; do not leave an unhandled rejection after a
timeout. Calculate `taskHash` with
`createHash("sha256").update(redactedPrompt).digest("hex")`. Only after a
non-null rendered pack wins, write its cache, append one `TaskKickoffEvent`,
and return the same envelope. Catch every error at the exported function
boundary and return `""`.

- [ ] **Step 4: Run the helper and hook tests to verify green**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the orchestration slice**

```bash
git add apps/cli/src/commands/context/shared.ts apps/cli/src/hooks/task-kickoff.ts apps/cli/test/hooks/task-kickoff.test.ts
git commit -m "feat(cli): emit stable task kickoff context"
```

## Task 5: Wire the installed intent hook and retention

**Files:**

- Modify: `apps/cli/src/hooks/intent-run.ts`
- Modify: `apps/cli/src/commands/hooks/intent.ts`
- Modify: `apps/cli/src/hooks/gc.ts`
- Modify: `apps/cli/test/hooks/intent-run.test.ts`
- Modify: `apps/cli/test/hooks/gc.test.ts`

**Interfaces:** `runIntentHookFromProcess` changes from `void` to
`Promise<void>` and retains its always-zero process contract. The Citty
handler becomes `async run() { await runIntentHookFromProcess(); }`.

- [ ] **Step 1: Write failing integration/retention tests**

Add a process-wrapper test that stubs `buildTaskKickoffHookOutput` to a known
JSON envelope, supplies valid stdin, and asserts stdout is exactly that JSON
while the legacy/session intent files still contain the redacted prompt. Add a
failure test where the task-kickoff builder throws: stdout remains empty and
`process.exitCode` is `0`.

Extend the GC fixture with an old
`stats/<workspace>/task-pack/<session>.json` and a fresh one. Assert one daily
successful GC removes only the old file; a missing directory remains a no-op.

- [ ] **Step 2: Run the integration tests to verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts test/hooks/gc.test.ts`

Expected: FAIL because the intent process path does not call the task-kickoff
builder and GC does not scan `task-pack`.

- [ ] **Step 3: Implement the fail-open wire**

Keep `captureIntent` unchanged and call it before task-pack assembly so saver
ranking never regresses if assembly fails. In `runIntentHookFromProcess`, parse
stdin once, call `captureIntent`, await `buildTaskKickoffHookOutput` with the
same parsed payload/store root/current clock, and write non-empty output only.
Wrap the entire path in its existing catch and set exit code `0` before work.

Extract `pruneTaskKickoffFiles` beside `pruneIntentFiles`, using the exact same
workspace walk, `.json` suffix filter, retention cutoff, and best-effort
per-file handling. Invoke it only after the GC marker has been claimed and the
main chunk prune succeeds.

- [ ] **Step 4: Run the integration tests to verify green**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts test/hooks/gc.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the wire slice**

```bash
git add apps/cli/src/hooks/intent-run.ts apps/cli/src/commands/hooks/intent.ts apps/cli/src/hooks/gc.ts apps/cli/test/hooks/intent-run.test.ts apps/cli/test/hooks/gc.test.ts
git commit -m "feat(cli): inject task kickoff on prompt"
```

## Task 6: Phase evidence and release record

**Files:**

- Create: `.changeset/cache-write-task-kickoff.md`
- Modify: `wiki/sources/cache-write-reduction-design.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Add the release and evidence contracts**

Create this changeset:

```md
---
"@megasaver/cli": minor
"@megasaver/stats": minor
---

Add stable task kickoff context and its measured injected-token cost event.
```

Append a wiki note stating that Phase 1 is implementation-complete only after
the commands below, a fresh-store paired benchmark, a real hook smoke, and two
independent reviews; do not write a savings figure before those receipts exist.

- [ ] **Step 2: Run focused packages and full verification**

Run:

```bash
pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts
pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-pack.test.ts test/hooks/task-kickoff-store.test.ts test/hooks/task-kickoff.test.ts test/hooks/intent-run.test.ts test/hooks/gc.test.ts
pnpm --filter @megasaver/gui build:bridge
pnpm verify
```

Expected: all commands exit `0`. The explicit bridge build is the known fresh-
worktree prerequisite until Turbo declares `dist-bridge/**` as an output; it
is not part of this feature's production change.

- [ ] **Step 3: Capture feature-specific runtime evidence**

With a temporary store and indexed fixture project, invoke `mega hooks intent`
twice with the same safe session id. Preserve the first JSON envelope and
verify the second invocation has empty stdout; verify exactly one task-kickoff JSONL event exists;
then invoke a real Claude Code session with the hook installed and capture a
single emitted envelope. Run a fresh-store, arm-isolated paired benchmark that
reports task completion, turns, input, cache creation, cache read, output, and
total normalized cost for both arms. Record no result as a product claim unless
the task outcome matches.

- [ ] **Step 4: Commit the release/evidence record**

```bash
git add .changeset/cache-write-task-kickoff.md wiki/sources/cache-write-reduction-design.md wiki/log.md
git commit -m "chore: record task kickoff release evidence"
```
