# Task Kickoff Final Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final Task Kickoff release blockers without weakening at-most-once delivery or the documented owner-only boundary.

**Architecture:** Extend the first-party hook-launcher matcher only for launchers the CLI writes. Harden the shared private JSONL append at its file descriptor so the prevalidated Task Kickoff directory chain cannot be escaped through a stable event-file symlink. Make the write boundary documentation honest, resolve Task Kickoff paths canonically, and enforce the already-existing release assertions in CI against a fully minified single-file bundle.

**Tech Stack:** TypeScript strict ESM, Node 22 `fs`, `fs/promises`, tsup/esbuild, Vitest, GitHub Actions.

## Global Constraints

- A task session still emits at most one optional response and a claim is permanent.
- An event follows only a successful stdout callback before the absolute deadline; a late or failed callback records no event.
- Stable symlink/non-regular task-kickoff event files fail closed. Active same-effective-UID replacement after descriptor validation remains outside the approved local owner-only boundary.
- No automatic task-pack or claim retention/deletion is introduced.
- Windows still writes no Task Kickoff state.
- `mega.mjs` remains a sidecar-free Node 22 bundle smaller than 12 MiB.
- Every task begins red, turns green, commits atomically, and receives a fresh reviewer.

---

### Task 1: Recognize only supported first-party hook launchers

**Files:**

- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `packages/connectors/claude-code/test/hook-settings.test.ts`

**Interfaces:** `hookCommandMatches(command, subcommand)` accepts bare `mega` plus absolute/quoted absolute `mega`, `mega.mjs`, `mega.cmd`, and `mega.exe` launchers; `cli.js` is accepted only below `apps/cli/dist/` or `@megasaver/cli/dist/`. Reinstall collapses duplicate owned commands to one while preserving foreign commands and entries.

- [ ] **Step 1: Write failing ownership tests**

```ts
for (const launcher of ["/opt/mega.mjs", "/opt/apps/cli/dist/cli.js", '"/opt/My App/mega.mjs"']) {
  const command = `${launcher} hooks intent --store "/tmp/store"`;
  expect(hookCommandMatches(command, "intent")).toBe(true);
  const installed = addUserPromptSubmitHook({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command }] }] } }, "/next/mega.mjs hooks intent --store \"/tmp/store\"");
  expect(installed.hooks?.UserPromptSubmit).toHaveLength(1);
  expect(hasUserPromptSubmitHook(installed, "/next/mega.mjs hooks intent --store \"/tmp/store\"")).toBe(true);
  expect(removeUserPromptSubmitHook(installed, "/next/mega.mjs hooks intent").hooks).toBeUndefined();
}
expect(hookCommandMatches("/opt/foreign-runner hooks intent", "intent")).toBe(false);
expect(hookCommandMatches("/opt/acme/cli.js hooks intent", "intent")).toBe(false);

const repaired = addUserPromptSubmitHook({
  hooks: { UserPromptSubmit: [
    { hooks: [{ type: "command", command: "/opt/mega.mjs hooks intent" }] },
    { hooks: [{ type: "command", command: "/opt/mega.mjs hooks intent" }, { type: "command", command: "foreign run" }] },
  ] },
}, "/next/mega.mjs hooks intent");
expect(repaired.hooks?.UserPromptSubmit).toEqual([
  { hooks: [{ type: "command", command: "/next/mega.mjs hooks intent", timeout: 10 }] },
  { hooks: [{ type: "command", command: "foreign run" }] },
]);
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts`

Expected: official `.mjs`/known-development `cli.js` paths fail to match, while existing duplicate owned entries remain duplicated.

- [ ] **Step 3: Implement the bounded launcher pattern**

```ts
const executable = String.raw`(?:mega(?:\.mjs|\.cmd|\.exe)?|(?:apps[\\/]cli|@megasaver[\\/]cli)[\\/]dist[\\/]cli\.js)`;
const launcher = String.raw`(?:mega|"(?:[A-Za-z]:)?(?:[\\/][^"]+)*[\\/]${executable}"|(?:[A-Za-z]:)?(?:[\\/]\S+)*[\\/]${executable})`;
return new RegExp(`^${launcher}${store} hooks ${subcommand}${store}$`).test(command);
```

Keep the store placement and exact full-command anchors unchanged. In `repairEntry`, retain the first owned command as `desired`, drop later owned matches, and preserve every non-owned command. Drop an entry only if that removal leaves it with no commands. Do not accept shell prefixes, `node <script>`, an arbitrary executable basename, or an arbitrary `cli.js` path.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts && pnpm exec biome check packages/connectors/claude-code/src/hook-settings.ts packages/connectors/claude-code/test/hook-settings.test.ts`

Commit: `fix(hooks): recognize installed launchers`

### Task 2: Refuse stable task-kickoff event-file symlinks

**Files:**

- Modify: `packages/stats/src/append-line.ts`
- Modify: `packages/stats/test/task-kickoff-event.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-process.test.ts`

**Interfaces:** `appendPrivateLine(path, line)` opens its final file with `O_NOFOLLOW | O_APPEND | O_CREAT`, rejects a non-regular descriptor, and changes owner-only mode through the descriptor before `writeSync`.

- [ ] **Step 1: Write the failing event-file regression**

```ts
it.skipIf(process.platform === "win32")("refuses a stable task-kickoff event symlink", () => {
  const outside = join(root, "outside.jsonl");
  writeFileSync(outside, "outside\n", { mode: 0o644 });
  mkdirSync(dirname(taskKickoffEventPath(root, WORKSPACE_KEY)), { recursive: true });
  symlinkSync(outside, taskKickoffEventPath(root, WORKSPACE_KEY));

  expect(() => appendTaskKickoffEvent({ root }, taskKickoffEventSchema.parse(event()))).toThrow();
  expect(readFileSync(outside, "utf8")).toBe("outside\n");
  expect(statSync(outside).mode & 0o777).toBe(0o644);
});
```

Add a process-runner assertion that a worker-side append failure leaves the post-write result true but stores no Task Kickoff event.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts && pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-process.test.ts`

Expected: the symlink target receives the JSON row and its mode changes to `0600`.

- [ ] **Step 3: Implement descriptor-bound private append**

```ts
const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
try {
  if (!fstatSync(fd).isFile()) throw new Error("private append target is not a regular file");
  fchmodSync(fd, 0o600);
  writeSync(fd, line);
} finally {
  closeSync(fd);
}
```

Leave directory preparation unchanged: the Task Kickoff storage preflight validates the stable parent chain before the worker can issue `ready`.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts && pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-process.test.ts && pnpm exec biome check packages/stats/src/append-line.ts packages/stats/test/task-kickoff-event.test.ts apps/cli/test/hooks/task-kickoff-process.test.ts`

Commit: `fix(stats): refuse symlinked event files`

### Task 3: Make the deadline boundary and canonical project lookup honest

**Files:**

- Modify: `apps/cli/src/hooks/task-kickoff.ts`
- Modify: `apps/cli/test/hooks/task-kickoff.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-process.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-task-kickoff-safety-amendment-plan.md`

**Interfaces:** Task Kickoff uses an asynchronous canonical resolver that returns a registered project only when the resolved cwd is its resolved root or descendant. `runTaskKickoffProcess` documents that a pre-deadline `stdout.write` can drain after deadline but cannot authorize an event after deadline.

- [ ] **Step 1: Write the failing canonical-root test and tighten the late-write assertion**

```ts
const aliasRoot = join(tmpdir(), `megasaver-kickoff-alias-${randomUUID()}`);
symlinkSync(projectRoot, aliasRoot, "dir");
registry.createProject({ ...project, rootPath: aliasRoot });
await expect(buildTaskKickoffHookOutput({
  ...input,
  payload: { prompt: "repair auth", cwd: realpathSync(aliasRoot), session_id: "canonical-root" },
})).resolves.not.toBe("");

await stdout.started;
await expect(result).resolves.toEqual({ wrote: false });
expect(worker.posted).toEqual([]);
expect(readTaskKickoffEvents({ root: storeRoot }, WORKSPACE_KEY)).toEqual([]);
```

The late-write test must explicitly call its envelope a queued pre-deadline write; it must not assert that the deadline retracts bytes already passed to `stdout.write`.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-process.test.ts`

Expected: a registered `/tmp` spelling fails when the hook uses the canonical macOS path.

- [ ] **Step 3: Implement a Task-Kickoff-only async canonical resolver**

```ts
const [resolvedCwd, ...resolvedRoots] = await Promise.all([realpath(cwd), ...projects.map((project) => realpath(project.rootPath))]);
return projects
  .filter((project, index) => isPathWithin(resolvedCwd, resolvedRoots[index]))
  .sort((left, right) => right.rootPath.length - left.rootPath.length)[0] ?? null;
```

If a `realpath` call fails, return null. Keep the general `findProjectByCwd` contract unchanged. Amend the safety documents to name the irreversible stdout boundary and the worker's best-effort synchronous intent capture precisely.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-process.test.ts && pnpm --filter @megasaver/cli typecheck`

Commit: `fix(cli): bind kickoff paths and deadline`

### Task 4: Enforce the release bundle ceiling in CI

**Files:**

- Modify: `apps/cli/tsup.bundle.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/cli/test/bundle-smoke.test.ts`

**Interfaces:** the bundle config uses full minification with retained names; CI builds the bundle and runs the focused bundle-smoke test names that include the `<12 MiB` assertion and Task Kickoff self-worker smoke.

- [ ] **Step 1: Verify the existing size gate is red**

Run: `pnpm --filter @megasaver/cli bundle && pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'keeps mega.mjs under 12MB'`

Expected: current 13.79 MiB artifact fails the existing `<12 MiB` assertion.

- [ ] **Step 2: Write the CI focused-bundle command test**

Add the exact `vitest -t` expression to the CI Bundle smoke step so it includes:

```text
runs task kickoff inside the single published bundle|ships no platform-specific|does not inline the onnxruntime|does not inline the @aws-sdk|keeps mega.mjs under 12MB|inlines the GUI bridge
```

- [ ] **Step 3: Enable safe full minification**

```ts
minify: true,
keepNames: true,
```

Replace `minifyWhitespace: true`. Preserve `startGuiBridge` in the output through `keepNames`; do not raise the 12 MiB ceiling or weaken the smoke assertion.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/cli bundle && pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'runs task kickoff inside the single published bundle|ships no platform-specific|does not inline the onnxruntime|does not inline the @aws-sdk|keeps mega.mjs under 12MB|inlines the GUI bridge' && node apps/cli/dist-bundle/mega.mjs doctor`

Commit: `fix(cli): enforce release bundle ceiling`

### Task 5: Record evidence and final review

**Files:**

- Modify: `.changeset/task-kickoff-safety.md`
- Modify: `wiki/sources/cache-write-reduction-design.md`
- Modify: `wiki/log.md`
- Modify: `wiki/agent-channel.md`

- [ ] **Step 1: Record the corrected boundaries**

State the supported launchers, descriptor-bound event append, canonical Task Kickoff project lookup, irreversible stdout boundary, exact Node 22 bundle size, and CI test command. Retain the no-savings claim until a paired benchmark exists.

- [ ] **Step 2: Run final evidence**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/stats test
pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-process.test.ts
pnpm --filter @megasaver/cli bundle
pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'runs task kickoff inside the single published bundle|ships no platform-specific|does not inline the onnxruntime|does not inline the @aws-sdk|keeps mega.mjs under 12MB|inlines the GUI bridge'
pnpm verify
```

Use Node 22. With temporary settings, install the built `mega.mjs` hook twice and prove it is not duplicated; uninstall it and prove only the owned entries disappear. Preserve the existing real-API receipt; do not spend another request unless the changed launcher path requires it.

- [ ] **Step 3: Fresh review and commit**

Request fresh `code-reviewer` and `critic` passes. Fix every Critical and Important finding, then commit:

```bash
git add .changeset/task-kickoff-safety.md wiki/sources/cache-write-reduction-design.md wiki/log.md wiki/agent-channel.md
git commit -m "docs(cache): record kickoff hardening"
```
