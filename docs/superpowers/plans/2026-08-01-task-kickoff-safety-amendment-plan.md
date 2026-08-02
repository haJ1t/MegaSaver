# Task Kickoff Safety Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task Kickoff session-global at-most-once context, delivery-correlated cost accounting, bounded hook work, and honest platform limits.

**Architecture:** A global safe-session claim selects one workspace before a pack can be emitted. A 500 ms parent-owned worker prepares the claim and pack; the parent writes the hook envelope and only then requests best-effort event accounting. The hook fails closed for task context but exits zero in every failure path.

**Tech Stack:** TypeScript strict ESM, Node 22 worker threads and `fs/promises`, Citty, Zod, Vitest, `@megasaver/stats`, Biome.

## Global Constraints

- A safe `session_id` receives at most one Task Kickoff response across every workspace for its lifetime.
- A claim is terminal even when partial or malformed; no retention path may remove task-kickoff state.
- A cost event follows only a stdout write callback that succeeds before the absolute deadline; an absent event is preferred to a false one.
- The parent terminates incomplete worker preparation at 500 ms and queues no output when preparation misses the write boundary. A pre-deadline queued write may drain later, but its late callback returns `{ wrote: false }` and never records an event.
- Task-kickoff storage is POSIX-only after owner-only file and directory synchronization; Windows emits no task-kickoff state.
- Stable regular-file and symlink components fail closed before state creation. Active same-UID replacement after descriptor validation is outside the owner-only local-store threat boundary; Node cannot close that TOCTOU without a separately shipped native `openat` implementation.
- `additionalContext` is no more than 9,000 UTF-16 code units and 2,000 real tokens; an oversized pack is rejected, never truncated.
- Every task starts red, turns green, is committed, then receives fresh external review.

---

### Task 1: Make the baked intent store executable

**Files:**

- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `packages/connectors/claude-code/test/hook-settings.test.ts`
- Modify: `apps/cli/src/commands/hooks/intent.ts`
- Modify: `apps/cli/src/hooks/intent-run.ts`
- Modify: `apps/cli/test/hooks/intent-run.test.ts`

**Interfaces:** `buildHookCommand("intent", { cliPath, storeRoot })` returns `<cli> hooks intent --store "<storeRoot>"`; `runIntentHookFromProcess(storeFlag?)` resolves exactly that override.

- [ ] **Step 1: Write failing tests**

```ts
expect(buildHookCommand("saver", { cliPath: "/usr/local/bin/mega", storeRoot: "/data" }))
  .toBe('/usr/local/bin/mega hooks saver --store "/data"');
expect(hookCommandMatches('/usr/local/bin/mega hooks saver --store "/data"', "saver"))
  .toBe(true);
await runCommand(hooksIntentCommand, { rawArgs: ["--store", configuredStore] });
expect(buildTaskKickoffHookOutput).toHaveBeenCalledWith(
  expect.objectContaining({ storeRoot: configuredStore }),
);
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts && pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts`

Expected: the pre-subcommand command and default-store runner fail these assertions.

- [ ] **Step 3: Implement the minimal wiring**

```ts
const hook = `hooks ${subcommand}`;
return `${bin} hooks ${subcommand}${store}`;
export async function runIntentHookFromProcess(storeFlag?: string): Promise<void> {
  const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
}
```

Declare `args.store` on the Citty intent command. Derive a registration's subcommand with `/(?:^|\\s)hooks\\s+(\\S+)/`, so an old pre-subcommand baked command is repaired in place rather than duplicated.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts && pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts && pnpm exec biome check packages/connectors/claude-code/src/hook-settings.ts packages/connectors/claude-code/test/hook-settings.test.ts apps/cli/src/commands/hooks/intent.ts apps/cli/src/hooks/intent-run.ts apps/cli/test/hooks/intent-run.test.ts`

Commit: `fix(hooks): honor baked intent store`

### Task 2: Use a global terminal session claim

**Files:**

- Modify: `apps/cli/src/hooks/task-kickoff-store.ts`
- Modify: `apps/cli/src/hooks/task-kickoff.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-store.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff.test.ts`

**Interfaces:** add `taskKickoffSessionClaimPath(root, session)`, `hasTaskKickoffSessionClaim(root, session)`, and `createTaskKickoffSessionClaim(root, session, { workspaceKey, eventId, createdAt }, signal)`. Existing workspace pack paths retain the winning payload only.

- [ ] **Step 1: Write failing session-movement tests**

```ts
const first = await buildTaskKickoffHookOutput({ ...input, payload: payload(projectA, "same") });
const moved = await buildTaskKickoffHookOutput({ ...input, payload: payload(projectB, "same") });
expect(first).not.toBe("");
expect(moved).toBe("");
expect(readTaskKickoffEvents({ root: store }, workspaceA)).toHaveLength(1);
expect(readTaskKickoffEvents({ root: store }, workspaceB)).toEqual([]);
```

Add a concurrent two-workspace version that observes exactly one non-empty result, and create a partial global claim fixture that returns empty without attempting recovery.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-store.test.ts test/hooks/task-kickoff.test.ts`

Expected: the current workspace-keyed claim allows both projects to emit.

- [ ] **Step 3: Implement the terminal winner**

```ts
if (hasTaskKickoffSessionClaim(input.storeRoot, sessionId)) return "";
const claimed = await createTaskKickoffSessionClaim(input.storeRoot, sessionId, claim, signal);
if (!claimed) return "";
writeTaskKickoffPack(input.storeRoot, workspaceKey, sessionId, pack);
```

Render before attempting the atomic claim. Never remove the global claim; remove workspace-claim cleanup and event retraction code. A post-claim timeout or failure keeps the claim and returns no context or cost event.

Until Task 3 adds the stdout-delivery bridge, Task 2 must not append a
`TaskKickoffEvent` at all. Update its focused success assertions to expect an
empty event list; an absent cost row is safe during this intermediate commit,
whereas the current pre-stdout event append is not.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-store.test.ts test/hooks/task-kickoff.test.ts && pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts`

Commit: `fix(cli): make task kickoff session-global`

### Task 3: Bound preparation and record only after stdout delivery

**Files:**

- Create: `apps/cli/src/hooks/task-kickoff-worker.ts`
- Create: `apps/cli/src/hooks/task-kickoff-process.ts`
- Modify: `apps/cli/src/hooks/intent-run.ts`
- Modify: `apps/cli/src/hooks/task-kickoff.ts`
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/tsup.config.ts`
- Modify: `apps/cli/tsup.bundle.config.ts`
- Create: `apps/cli/test/hooks/task-kickoff-process.test.ts`
- Modify: `apps/cli/test/hooks/intent-run.test.ts`
- Modify: `apps/cli/test/bundle-smoke.test.ts`
- Modify: `packages/stats/src/task-kickoff-event.ts`
- Modify: `packages/stats/test/task-kickoff-event.test.ts`

**Interfaces:** the worker receives only serializable `{ payload, storeRoot, deadlineMs }` and yields `{ envelope: string; event: TaskKickoffEvent } | null`. `runTaskKickoffProcess` owns `Worker`, deadline, stdout callback, and a post-write `record` message; its injectable test dependencies live only in the parent process.

- [ ] **Step 1: Write failing process tests**

```ts
await expect(runTaskKickoffProcess(hangingWorkerInput)).resolves.toEqual({ wrote: false });
expect(elapsedMs).toBeLessThan(550);
expect(stdout).toBe("");
expect(readTaskKickoffEvents({ root: store }, workspace)).toEqual([]);

await expect(runTaskKickoffProcess(writeFailureInput)).resolves.toEqual({ wrote: false });
expect(readTaskKickoffEvents({ root: store }, workspace)).toEqual([]);
```

Add a writable-stream fixture proving one event appears only after its write callback. Add a deadline-after-claim fixture proving the claim remains while output and events remain absent. Add a pending-write fixture proving that a write queued before the deadline is irreversible: its bytes may drain after the deadline, but the late callback returns false and never requests accounting.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-process.test.ts test/hooks/intent-run.test.ts && pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts`

Expected: current synchronous assembly appends its event before stdout and cannot be terminated by a parent deadline.

- [ ] **Step 3: Implement the protocol**

```ts
const worker = new Worker(new URL("./task-kickoff-worker.js", import.meta.url), {
  workerData: { payload: input.payload, storeRoot: input.storeRoot, deadlineMs: input.deadlineMs },
});
const timeout = setTimeout(() => worker.terminate(), 500);
worker.once("message", async ({ envelope, event }) => {
  const wrote = await writeStdout(envelope);
  if (wrote) worker.postMessage({ kind: "record", event });
});
```

The parent starts one absolute deadline before it reads stdin, then performs no
filesystem work. The worker captures intent and sends `ready` only after
global-claim and pack persistence, then acknowledges the post-stdout `record`
message after appending the event. The parent retains the same deadline until
acknowledgement or worker termination; it must not terminate immediately after
`record`. `writeStdout` resolves false for callback errors, synchronous throws,
and callbacks that complete after the absolute deadline. Once `stdout.write`
has accepted an envelope, the parent cannot retract its bytes; the late path
prevents only success reporting and accounting. Worker stdout/stderr is drained
and discarded. Clear the timer in all terminal paths and set process exit code
zero. The unbundled build emits a
worker entry; the published `mega.mjs` uses an `isMainThread` branch to execute
that worker logic from the same file. The bundle smoke runs `mega.mjs hooks
intent` against an indexed fixture and proves the self-worker completes its
event ACK without a release sidecar.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-process.test.ts test/hooks/intent-run.test.ts test/hooks/task-kickoff.test.ts && pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts`

Commit: `fix(cli): bound task kickoff delivery`

### Task 4: Enforce POSIX safety and output bounds

**Files:**

- Modify: `apps/cli/src/hooks/task-kickoff-store.ts`
- Modify: `apps/cli/src/hooks/task-kickoff-pack.ts`
- Modify: `apps/cli/src/hooks/task-kickoff.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-store.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-pack.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff.test.ts`

**Interfaces:** export `TASK_KICKOFF_CHARACTER_CAP = 9_000`; storage setup returns null on `win32` or any file/directory sync error.

- [ ] **Step 1: Write failing tests**

```ts
await expect(renderTaskKickoffPack({ ...largeInput, count: async () => 10 })).resolves.toBeNull();
await expect(buildTaskKickoffHookOutput({ ...input, platform: "win32" })).resolves.toBe("");
expect(existsSync(taskKickoffSessionClaimPath(store, session))).toBe(false);
```

On POSIX inject a directory-sync failure and assert no envelope or event. Assert successful claim/pack parent directories are `0700` and files `0600`.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-pack.test.ts test/hooks/task-kickoff-store.test.ts test/hooks/task-kickoff.test.ts`

Expected: oversized text and Windows currently permit task-kickoff persistence.

- [ ] **Step 3: Implement fail-closed persistence**

```ts
if (platform === "win32" || rendered.text.length > TASK_KICKOFF_CHARACTER_CAP) return null;
await handle.sync();
await syncDirectory(dirname(path));
```

Use asynchronous `open`, `writeFile`, `sync`, and `rename` for Task Kickoff claim/pack persistence, then synchronize the owning directory after create/rename. Best-effort intent capture keeps its synchronous atomic writer only inside the isolated worker, so worker termination can abandon it without blocking the parent. Do not delete an already-created global claim when a later durability step fails.

Reject stable regular-file and symlink components before task state creation.
Do not attempt to solve a post-validation same-UID replacement race with a
path-based retry or cleanup: the approved safety boundary explicitly excludes
that attacker until a native descriptor-relative filesystem package is shipped.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-pack.test.ts test/hooks/task-kickoff-store.test.ts test/hooks/task-kickoff.test.ts && pnpm --filter @megasaver/cli typecheck`

Commit: `fix(cli): fail closed task kickoff persistence`

### Task 5: Align GC, documentation, release evidence, and review

**Files:**

- Modify: `apps/cli/src/hooks/gc.ts`
- Modify: `apps/cli/test/hooks/gc.test.ts`
- Modify: `docs/superpowers/plans/2026-08-01-cache-write-reduction-phase-1-plan.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/cli-reference.md`
- Create: `.changeset/task-kickoff-safety.md`
- Modify: `wiki/sources/cache-write-reduction-design.md`
- Modify: `wiki/log.md`

**Interfaces:** overlay GC preserves all task-pack paths. Public docs call kickoff a one optional session-wide response; a cost row is a locally stdout-confirmed emission, not proof of model consumption.

- [ ] **Step 1: Write the GC regression**

```ts
await maybeRunOverlayGc(store, { now: () => NOW, prune: async () => ({ removed: 0 }) });
expect(existsSync(oldPack)).toBe(true);
expect(existsSync(oldClaim)).toBe(true);
```

- [ ] **Step 2: Verify red against any task-pack pruner**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/gc.test.ts`

Expected: a restored task-pack pruner removes the old fixture.

- [ ] **Step 3: Document the retained safety policy**

Keep task-pack paths out of `maybeRunOverlayGc`; remove stale 30-day task-pack lifecycle language. Document the POSIX-only behavior, permanent claim, 9,000-character cap, and local emission-accounting meaning. Append the decision and all verification receipts to the wiki log.

- [ ] **Step 4: Verify, smoke, review, and commit**

Run:

```bash
pnpm --filter @megasaver/stats build
pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts
pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-pack.test.ts test/hooks/task-kickoff-store.test.ts test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-process.test.ts test/hooks/intent-run.test.ts test/hooks/gc.test.ts
pnpm --filter @megasaver/gui build:bridge
pnpm verify
```

With two indexed fixture projects and a temporary Claude settings file, install hooks with `--store`; verify one real prompt makes one global claim, one pack, and one event; invoke the same session in the other fixture and verify empty stdout. Cap the request at USD 0.25 and record token classes without claiming savings. Request fresh read-only `code-reviewer` and `critic` passes, fix all Critical and Important findings, then commit `chore: record task kickoff safety evidence`.
