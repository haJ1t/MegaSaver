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
- The 500 ms deadline starts in the CLI entry module before the dynamic command
  graph import; a late command graph cannot create a second optional-work
  window.
- Every Task Kickoff workspace path accepts only `workspaceKeySchema`; no
  public path facade accepts traversal-capable workspace input.

---

### Task 1: Recognize only supported first-party hook launchers

**Files:**

- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `packages/connectors/claude-code/test/hook-settings.test.ts`
- Modify: `apps/cli/src/commands/hooks/saver.ts`
- Modify: `apps/cli/src/commands/hooks/warmup.ts`
- Modify: `apps/cli/src/commands/hooks/guard.ts`
- Modify: `apps/cli/src/hooks/saver-run.ts`
- Modify: `apps/cli/src/hooks/warmup-run.ts`
- Modify: `apps/cli/src/hooks/guard-run.ts`
- Modify: relevant hook command/runner tests

**Interfaces:** `hookCommandMatches(command, subcommand)` deterministically parses only bare `mega` plus absolute/quoted absolute `mega`, `mega.mjs`, `mega.cmd`, and `mega.exe` launchers; `cli.js` is accepted only below `apps/cli/dist/` or `@megasaver/cli/dist/`. Reinstall collapses duplicate owned commands to one while preserving foreign commands, entries, matchers, and metadata.

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

const repaired = addPreToolUseHook({
  hooks: { PreToolUse: [
    { matcher: "Read", hooks: [{ type: "command", command: "/opt/mega.mjs hooks log" }] },
    { matcher: "Write", custom: "keep", hooks: [{ type: "command", command: "/opt/mega.mjs hooks log" }, { type: "command", command: "foreign run" }] },
  ] },
}, "/next/mega.mjs hooks log");
expect(repaired.hooks?.PreToolUse).toEqual([
  { matcher: HOOK_MATCHER, hooks: [{ type: "command", command: "/next/mega.mjs hooks log", timeout: 10 }] },
  { matcher: "Write", hooks: [{ type: "command", command: "foreign run" }], custom: "keep" },
]);

const manySegments = `"/${Array.from({ length: 24 }, () => "segment").join("/")}/foreign" hooks intent`;
const startedAt = performance.now();
expect(hookCommandMatches(manySegments, "intent")).toBe(false);
expect(performance.now() - startedAt).toBeLessThan(100);
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts`

Expected: official `.mjs`/known-development `cli.js` paths fail to match, while existing duplicate owned entries remain duplicated.

- [ ] **Step 3: Implement the bounded launcher pattern**

```ts
const tokens = tokenizeHookCommand(command);
if (tokens === null || !isFirstPartyLauncher(tokens[0])) return false;
const cursor = consumeOptionalStore(tokens, 1);
if (cursor === null || tokens[cursor] !== "hooks" || tokens[cursor + 1] !== subcommand) return false;
return consumeOptionalStore(tokens, cursor + 2) === tokens.length;
```

`tokenizeHookCommand` scans each character once and rejects unmatched quotes or a quote inside an unquoted token. `isFirstPartyLauncher` classifies the resulting token without a path regex. In `repairEntry`, retain the first owned command as `desired` and drop later owned matches. If the first owned command shares an entry with foreign hooks, preserve that entry with its original matcher/metadata and add a separate desired entry; drop an entry only if all its commands were owned. Do not accept shell prefixes, `node <script>`, an arbitrary executable basename, or an arbitrary `cli.js` path.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/connector-claude-code exec vitest run test/hook-settings.test.ts && pnpm exec biome check packages/connectors/claude-code/src/hook-settings.ts packages/connectors/claude-code/test/hook-settings.test.ts`

Commit: `fix(hooks): recognize installed launchers`

### Task 2: Refuse stable task-kickoff event-file symlinks

**Files:**

- Modify: `packages/stats/src/append-line.ts`
- Modify: `packages/stats/test/task-kickoff-event.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-process.test.ts`

**Interfaces:** on POSIX, `appendPrivateLine(path, line)` opens its final file with `O_NOFOLLOW | O_NONBLOCK | O_APPEND | O_CREAT`, rejects a non-regular descriptor, and changes owner-only mode through the descriptor before `writeSync`.

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

it.skipIf(process.platform === "win32")("refuses a stable task-kickoff event FIFO without blocking", () => {
  const eventPath = taskKickoffEventPath(root, WORKSPACE_KEY);
  mkdirSync(dirname(eventPath), { recursive: true });
  execFileSync("mkfifo", [eventPath]);
  const result = runIsolatedAppend(eventPath, { timeout: 1_000 });
  expect(result.status).toBe(1);
  expect(result.signal).toBeNull();
});
```

The 1,000 ms value is an isolated-process test watchdog, not a product timeout:
it includes scheduler admission, Node startup, and TypeScript import during the
full parallel Turbo gate. Mutation-check it by removing `O_NONBLOCK`; that
blocking control must still fail with `ETIMEDOUT`.

Add a process-runner assertion that a worker-side append failure leaves the post-write result true but stores no Task Kickoff event.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts && pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff-process.test.ts`

Expected: the symlink target receives the JSON row and its mode changes to `0600`; the FIFO worker must be killed by its 1,000 ms watchdog because current `openSync` waits for a reader before `fstat`.

- [ ] **Step 3: Implement descriptor-bound private append**

```ts
const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
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
- Modify: `apps/cli/src/hooks/task-kickoff-worker.ts`
- Modify: `apps/cli/test/hooks/task-kickoff.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-process.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-task-kickoff-safety-amendment-plan.md`

**Interfaces:** export `canonicalPathContains(rootPath, cwd)` for its native-path boundary tests. Task Kickoff uses an asynchronous canonical resolver that returns a project only for one uniquely deepest resolved root; a deepest-root tie returns null. `runTaskKickoffProcess` documents that a pre-deadline `stdout.write` can drain after deadline but cannot authorize an event after deadline.

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

const nestedRoot = join(projectRoot, "nested");
const longParentAlias = join(tmpdir(), `megasaver-kickoff-parent-${"x".repeat(96)}`);
mkdirSync(join(nestedRoot, "src"), { recursive: true });
writeFileSync(join(nestedRoot, "src", "nested.ts"), "export function repairNested() { return true; }\n");
symlinkSync(projectRoot, longParentAlias, "dir");
const nestedProjectId = randomUUID();
registry.createProject({ id: randomUUID(), name: "long-parent", rootPath: longParentAlias, createdAt: NOW_ISO, updatedAt: NOW_ISO });
registry.createProject({ id: nestedProjectId, name: "nested", rootPath: nestedRoot, createdAt: NOW_ISO, updatedAt: NOW_ISO });
await buildIndex({ rootDir: nestedRoot, storeDir: storeRoot, projectId: nestedProjectId });
await expect(buildTaskKickoffHookOutput({
  ...input,
  payload: { prompt: "repair nested", cwd: join(nestedRoot, "src"), session_id: "nested" },
})).resolves.not.toBe("");
expect(readTaskKickoffPack(storeRoot, encodeWorkspaceKey(nestedRoot), "nested")).toBeDefined();
expect(readTaskKickoffPack(storeRoot, encodeWorkspaceKey(longParentAlias), "nested")).toBeUndefined();

expect(canonicalPathContains(sep, `${sep}tmp`)).toBe(true);

const aliasA = join(tmpdir(), `megasaver-kickoff-duplicate-a-${randomUUID()}`);
const aliasB = join(tmpdir(), `megasaver-kickoff-duplicate-b-${randomUUID()}`);
symlinkSync(projectRoot, aliasA, "dir");
symlinkSync(projectRoot, aliasB, "dir");
registry.createProject({ id: randomUUID(), name: "alias-a", rootPath: aliasA, createdAt: NOW_ISO, updatedAt: NOW_ISO });
registry.createProject({ id: randomUUID(), name: "alias-b", rootPath: aliasB, createdAt: NOW_ISO, updatedAt: NOW_ISO });
await expect(buildTaskKickoffHookOutput({
  ...input,
  payload: { prompt: "ambiguous", cwd: realpathSync(aliasA), session_id: "ambiguous-alias" },
})).resolves.toBe("");
expect(existsSync(taskKickoffSessionClaimPath(storeRoot, "ambiguous-alias"))).toBe(false);
```

The late-write test must explicitly call its envelope a queued pre-deadline write; it must not assert that the deadline retracts bytes already passed to `stdout.write`.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-process.test.ts`

Expected: a registered `/tmp` spelling fails when the hook uses the canonical macOS path.

- [ ] **Step 3: Implement a Task-Kickoff-only async canonical resolver**

```ts
const candidates = (await Promise.all(projects.map(async (project) => ({ project, resolvedRoot: await realpath(project.rootPath) }))))
  .filter((candidate) => canonicalPathContains(candidate.resolvedRoot, resolvedCwd))
  .sort((left, right) => right.resolvedRoot.length - left.resolvedRoot.length);
const first = candidates[0];
return first !== undefined && candidates.filter((candidate) => candidate.resolvedRoot.length === first.resolvedRoot.length).length === 1
  ? first.project
  : null;
```

`canonicalPathContains` accepts equality or a descendant after the native separator; when the root already ends in the separator, it compares directly against that root rather than adding a second separator. If cwd `realpath` fails, return null; if a candidate-root `realpath` fails, exclude only that candidate. If more than one matching candidate shares the greatest canonical-root length, return null before storage/claim creation. Keep the general `findProjectByCwd` contract unchanged. Amend the safety documents to name the irreversible stdout boundary and the worker's best-effort synchronous intent capture precisely.

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

Make the selected Task Kickoff bundle test platform-aware rather than skipping
Windows. Its existing POSIX assertions remain a non-empty UserPromptSubmit
envelope plus one Task Kickoff event. On Windows it must assert the same built
bundle exits zero with `stdout === ""` and `readTaskKickoffEvents(...) === []`;
Windows intentionally creates no Task Kickoff state.

- [ ] **Step 3: Enable safe full minification**

```ts
minify: true,
keepNames: true,
```

Replace `minifyWhitespace: true`. Preserve `startGuiBridge` in the output through `keepNames`; do not raise the 12 MiB ceiling or weaken the smoke assertion.

- [ ] **Step 4: Verify green and commit**

Run: `pnpm --filter @megasaver/cli bundle && pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'runs task kickoff inside the single published bundle|ships no platform-specific|does not inline the onnxruntime|does not inline the @aws-sdk|keeps mega.mjs under 12MB|inlines the GUI bridge' && node apps/cli/dist-bundle/mega.mjs doctor`

Commit: `fix(cli): enforce release bundle ceiling`

- [ ] **Step 5: Separate normal and strong runtime-cancellation evidence**

Keep the product's 500 ms absolute deadline unchanged and add no retries. The
normal full-suite fixture treats a missing Git-start marker as allowed
incomplete optional preparation, while always requiring the delayed survival
marker to remain absent. When Git starts, the absent delayed marker remains the
cancellation proof. A narrowly named test environment variable, set only on the
CI Bundle smoke step, enables strong evidence: POSIX additionally requires the
Git-start marker, then still requires the delayed marker to remain absent.
Windows deliberately creates no Task Kickoff state and never requires Git to
start in either mode.

First add a deterministic no-start runtime fixture and watch the old
unconditional start assertion fail. Mutation-check strong mode with a runtime
that lets fake Git live long enough to write the delayed marker; the helper must
reject it. Add only the uniquely named single-bundle cancellation test to the
focused CI selector so the similarly named dist-CLI cancellation test is not
selected accidentally.

Run:

```bash
pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'accepts incomplete preparation when fake Git never starts'
pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'rejects a runtime that lets delayed Git survive in strong mode'
MEGASAVER_BUNDLE_CANCEL_REQUIRE_GIT_START=1 pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'cancels delayed Git in the single published bundle'
```

Then run the exact CI selector, CLI typecheck, and Biome. The environment
variable belongs only to the workflow step's `env:` mapping so it applies
cross-platform without changing Windows assertions.

### Task 5: Record evidence and final review

**Files:**

- Modify: `apps/cli/test/hooks/saver.test.ts`
- Modify: `apps/cli/test/hooks/saver-run.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-task-kickoff-final-hardening-plan.md`
- Modify: `.changeset/task-kickoff-safety.md`
- Modify: `wiki/sources/cache-write-reduction-design.md`
- Modify: `wiki/log.md`
- Modify: `wiki/agent-channel.md`

- [ ] **Step 1: Record the corrected boundaries**

State the supported launchers, descriptor-bound event append, canonical Task Kickoff project lookup, irreversible stdout boundary, exact Node 22 bundle size, and CI test command. Retain the no-savings claim until a paired benchmark exists.

- [ ] **Step 2: Run final evidence**

Before rerunning the full gate, replace `X.repeat(50_000)` only in the two
`buildSaverDecision evidence-ledger wiring (real record)` compression tests with
a deterministic exact-50,000-byte corpus of unique code lines. Keep
`recordAndFilterOverlayOutput` real and retain the 50KB size. Add assertions for
the compressed hook output, persisted chunk count, one overlay event with
`rawBytes === 50_000` and measured token fields in both real compression paths.
The successful evidence path must append one evidence record with returned
chunk references and `redactionReport.redacted === false`; the injected
evidence-write failure must append zero evidence records while its compressed
response, persisted chunks, and overlay event survive. Run the focused saver
file under Node 22 and require all 68 tests to finish promptly without RPC or
unhandled errors; then run CLI typecheck and Biome before the full gate.

If the full parallel gate exposes the same RPC starvation in the `makeRecord`
daemon/fallback integration fixture, replace its shared `X.repeat(50_000)` input
with a separate deterministic exact-50,000-byte unique-code-line corpus. Keep
every daemon transport, direct persistence, in-process fallback, and fallback
accounting assertion intact. Prove the corpus byte length explicitly, run the
focused file under Node 22, and rerun the full gate.

The prerequisite test-fix commits before the final documentation-only commit
are `1b39f07e` (`test(cli): use realistic saver corpus`) and its immediate review
follow-up (`test(cli): align saver corpus evidence`). Neither test-fix commit
stages the four Task 5 closure documents; those remain exclusive to Step 3.

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

### Task 6: Close final review boundary findings

**Files:**

- Create: `apps/cli/src/hooks/task-kickoff-deadline.ts`
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/hooks/intent-run.ts`
- Modify: `apps/cli/src/hooks/task-kickoff-process.ts`
- Modify: `apps/cli/src/hooks/task-kickoff.ts`
- Modify: `apps/cli/src/commands/context/shared.ts`
- Modify: `apps/cli/src/hooks/task-kickoff-store.ts`
- Modify: `apps/cli/test/hooks/intent-run.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff.test.ts`
- Modify: `apps/cli/test/hooks/task-kickoff-store.test.ts`
- Modify: `apps/cli/test/bundle-smoke.test.ts`
- Modify: `packages/stats/src/task-kickoff-event.ts`
- Modify: `packages/stats/test/task-kickoff-event.test.ts`
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `packages/connectors/claude-code/test/hook-settings.test.ts`

**Interfaces:** `recordTaskKickoffProcessEntry()` runs in `cli.ts` before the
dynamic Citty/main imports. `runIntentHookFromProcess()` uses that recorded
timestamp to retain one absolute 500 ms deadline, falling back to a fresh call
only for direct non-CLI library invocation. On POSIX,
`readCoChangeLogAsync()` starts Git detached and, on abort, sends `SIGTERM` to
its negative process-group id with a direct-child fallback. Task Kickoff event
and pack workspace input parse `workspaceKeySchema` before constructing paths.

Task Kickoff calls the shared context-pack builder with an explicit
deterministic-memory mode that skips `taskScopedMemoryFiles` and therefore any
cold embedding request; the interactive context command retains task-scoped
memory ranking. Generated hook arguments use POSIX single-quote escaping and
the ownership tokenizer accepts the exact generated form. The stdin reader
accepts at most 256 KiB before JSON parse/Worker clone; it does not claim to
interrupt an operating-system-blocked slow pipe.

The Windows ownership classifier folds only supported launcher basenames and
the approved `apps/cli/dist/cli.js` segments, matching Windows filesystem
semantics; POSIX classifier comparisons stay case-sensitive.
It accepts only drive-qualified or full UNC Windows paths, never a
single-leading-backslash root-relative shell spelling.

For a non-default store, new hook rendering bakes `--store` only into the
stateful `intent`, `saver`, `warmup`, and `guard` commands. Each command parses
the option and passes it to its existing runner/store resolver. The cwd-local
`log` command receives no store option; legacy store-bearing log commands still
match ownership so uninstall can remove them.

- [ ] **Step 1: Write failing boundary regressions**

Add a deterministic intent-run test that records a CLI entry timestamp, advances
the clock 400 ms, and expects its worker deadline to remain entry + 500 ms
rather than call + 500 ms. Restore the process-local test marker afterwards.

Change the POSIX fake `git` in the runtime bundle cancellation fixture to spawn
an ordinary, non-detached child that sleeps for 750 ms then writes the delayed
marker; the direct shell remains alive. Run the current bundle in strong mode:
the direct start marker is present but the old direct-child-only abort permits
the descendant marker to appear.

For each public Task Kickoff facade, pass `../../escape` as its workspace key,
assert the call rejects/fails closed, and assert no sibling of the store root
is created or read. Retain the positive fixed 16-lowercase-hex path case.

Create a project with a valid memory-vector sidecar and prove Task Kickoff
builds its deterministic context pack without calling the embedding seam. Add
a normal interactive-context regression separately if needed to prove its
task-scoped behavior remains unchanged.

Add a launcher/store path containing whitespace, `$`, backticks, a single
quote, semicolon, and ampersand. Assert the generated command is parsed as
owned, remains idempotent across reinstall, and a controlled shell invocation
does not expand or execute those characters. Add an over-256-KiB completed
stdin fixture that exits zero before JSON parsing or worker creation; retain
the explicit slow-pipe caveat rather than asserting that a synchronous file
descriptor read is preemptible.

Add uppercase/mixed-case Windows `mega.cmd`, `mega.exe`, and approved
`apps/cli/dist/cli.js` ownership/lifecycle cases. Prove identical case-variant
paths remain foreign on POSIX.
Add a negative root-relative single-leading-backslash `\\foreign\\mega`
command that must remain foreign; retain a positive fully qualified UNC
launcher case.

On POSIX, pre-create a stable symlink at a Task Kickoff claim or pack directory
component (for example the workspace directory below `stats`). Prove the target
bytes and mode remain unchanged and that the hook emits no output, claim, pack,
or event. This complements the final-event-file symlink/FIFO tests with an
integrated `O_DIRECTORY | O_NOFOLLOW` chain regression.

Seed a valid real store/project, invoke the actual dist or bundle `hooks intent`
command through a stable symlinked store-root path, and prove stdout is empty
with no claim, pack, event, or `stats/<workspace>/intent/<session>.json` in the
symlink target. The red path must show that preflight rejects the Task Kickoff
pack but the old worker still wrote its intent before it.

Also point `--store` at a stable symlink to an *empty* outside directory without
calling store initialization on that target. The red path creates
`projects.json`/`sessions.json` through `ensureStoreReady` before storage
preflight. The fixed shared root gate rejects it before any initialization and
leaves the target directory empty.

Pre-create `stats/<encodeWorkspaceKey(cwd)>/intent` as a stable symlink to an
outside directory where `cwd` is a nested child of the registered project. The
red implementation validates the project-root workspace instead, then writes
or chmods the outside target. The fixed capture preflight validates the exact
cwd-derived workspace and leaves the outside target untouched while the
separately safe Task Kickoff envelope/event remains deliverable. Add the named
regression and the post-delivery intent-failure regression to the exact CI
Bundle smoke selector, not only the full suite that may skip when no bundle
artifact exists.

Add a same-session A→B bundle regression proving the second prompt updates
latest intent even though its permanent Task Kickoff claim suppresses output.
Add an unindexed/duplicate-path intent regression and preserve the existing
cross-platform intent writer coverage so the Windows no-Task-Kickoff path still
attempts intent capture.

On POSIX, add an owned-looking absolute `/opt/foreign/mega.exe` or `.cmd`
command and prove matcher/install/status/uninstall leave it foreign. Retain the
positive recognized drive/UNC Windows equivalents.

Install to a custom store, then execute each stateful generated command against
a fixture whose required state exists only in that store; prove its runner uses
that custom root. Assert a newly generated log command has no `--store`, and
that a legacy store-bearing owned log entry is still removed rather than left
behind.

- [ ] **Step 2: Verify red**

Run the focused intent/store/stats tests and the Node 22 strong bundle
cancellation selector. Expected: the deadline test observes a new 500 ms
window, the delayed descendant writes its marker, and traversal-capable keys
are accepted by at least one direct path facade.

- [ ] **Step 3: Implement the bounded fixes**

Keep the timestamp module side-effect-free until `cli.ts` records it. Do not
add an environment switch, startup retry, or parent-side filesystem operation.
The deadline helper must only fall back when no entry timestamp was recorded;
it must not refresh an expired real-process budget.

For POSIX Git, own the process group at spawn and remove the abort listener
when the callback settles. On abort, attempt `process.kill(-child.pid,
"SIGTERM")`; if the group is unavailable, attempt a direct `child.kill`.
Resolve the co-change log as empty on any spawn/cancellation error. Do not pass
Node's `signal` option as a competing direct-child cancellation path.

Parse `workspaceKeySchema` at the stats event schema/path boundary and before
the CLI Task Kickoff pack facade interpolates it into a path or asks the
directory preparer to do so. Keep safe session-id behavior unchanged.

Add an explicit context-pack memory-selection option with the existing
task-scoped behavior as its default. Task Kickoff selects the deterministic
approved-memory fallback; do not remove the interactive command's relevance
signal. Render every generated launcher and store argument through a minimal
POSIX single-quote encoder (`'` becomes `'"'"'` within a quoted token), then
extend the linear ownership tokenizer only far enough to decode those generated
tokens and reject other unsupported shell grammar. Implement a 256-KiB
`readSync`-based stdin cap that stops before parse/clone once the cap is
exceeded; a slow pipe may still block in a read and is documented as outside
this internal optional-work deadline.

Case-fold only explicitly Windows-style absolute launcher paths before checking
the recognized basename and development-distribution segments. Do not make a
POSIX slash path case-insensitive or relax the launcher allow-list.
Require a drive root or a UNC server-and-share root before applying Windows
case folding; reject a root-relative single-backslash spelling.

Add Citty `store` arguments and optional runner store-flag parameters for
`saver`, `warmup`, and `guard`; pass their flags into `readStoreEnv` exactly as
intent already does. Keep log cwd-local and omit its generated store argument.
Do not write a compatibility shim that silently redirects a specified custom
store to the default one.

Keep the Task Kickoff claim/pack directory preflight independent from intent.
Add a worker-local no-follow owner-only intent preflight for exactly
`encodeWorkspaceKey(payload.cwd)`, then begin the capture attempt for every
valid prompt before Task Kickoff preparation can return for a duplicate, missing
project, timeout, or Windows path. A failed intent preflight or write is a
capture-only false negative: it never prevents a separately safe envelope,
claim, pack, or event. Install the record listener before posting `ready`. After
the stdout callback, append the event in the main process (the Task Kickoff
worker must not load the native lock binding), then post `record` only to drive
the worker's intent-completion acknowledgement. Keep the parent worker alive
through that acknowledgement or its existing absolute deadline. On a no-output
path, finish the capture attempt before posting `done`. Restrict `.cmd` and
`.exe` basenames to recognized Windows drive/UNC paths; leave POSIX absolute
ownership limited to its supported native launchers.

Run the shared safe store-root gate before either intent capture or
`ensureStoreReady`. It may create a missing final root directory but must then
validate every normalized absolute component without following a stable
symlink. On POSIX retain each component descriptor long enough to `fstat` its
owner/mode: accept only root/effective-user-owned ancestors, allow writable
ones only if sticky and trusted, and require effective-user-owned owner-only
descendants after a sticky parent. Reject foreign-owned, non-sticky writable,
or overly broad descendants before creating deeper components; residual
same-effective-user/root, hostile ACL, and NFS races are explicitly outside the
local mode-bit boundary. On Windows, use a dedicated directory-and-`lstat`
preflight that rejects stable reparse/symlink and non-directory components
rather than invoking unsupported POSIX `O_DIRECTORY`/`O_NOFOLLOW` or directory
`sync` behavior. Keep the existing Windows Task Kickoff no-state contract while
restoring cross-platform latest-intent persistence.

Keep a real bundle artifact smoke in the dedicated CI job, but allow its valid
empty/no-event result when the entry-inclusive 500 ms deadline expires under
load. Make positive accounting proof deterministic through the worker/process
protocol and native-unavailable fallback suites, rather than requiring delivery
or a fake-Git process start from a real bundle invocation. The normal parallel
bundle suite has the same no-output/no-event allowance; CI explicitly selects
the deterministic delivery, held-lock deadline, and fallback assertions, plus
the real `prepareTaskKickoff` detached-Git integration that waits for start,
aborts, and rejects the delayed descendant marker.

For every private JSONL append, lock the already-open target descriptor through
the existing cross-platform native descriptor-lock dependency; do not create a
PID/mtime lock sidecar. A non-blocking lock miss fails closed within the hook
budget, and main hook-process termination releases the descriptor automatically. Under the
lock, repair an existing unterminated tail to its last newline, remember the
pre-append size, loop short writes to completion, and truncate back to that size
on zero-progress or write error. Keep committed data successful even if an
explicit unlock reports an error; descriptor close releases the lock. Document
local-filesystem-only advisory locking and retain NFS outside this boundary.
For Task Kickoff, pass the single entry-inclusive deadline through the event
append boundary: a post-stdout accounting attempt may use only the remaining
time and must not begin a fresh 500 ms descriptor-lock wait.

Keep `fs-ext` external to the platform-neutral single-file release. When a
copied bare `mega.mjs` cannot resolve that native dependency, do not drop the
already delivered event: publish a Task-Kickoff-only owner-only immutable part
under `task-kickoff-parts/<uuid>/event.json`, using exclusive UUID-directory
creation plus temporary-file rename. Reject stable symlink/non-directory part
targets, read valid parts in deterministic lexical order alongside JSONL, and
deduplicate by event id. This fallback must not weaken generic private JSONL
append semantics. Recheck the absolute deadline immediately before the temporary
write and again immediately before rename, removing an unpublished temporary
file on expiry. Add red/green tests for: a raw copied bundle with global module
lookup disabled; concurrent direct fallback publishers; stable part-target symlink
rejection; an expired fallback that never publishes; and a held descriptor lock
with a near-deadline stdout callback that terminates without an event before the
global budget elapses.

- [ ] **Step 4: Verify green and commit**

Run, under Node 22:

```bash
pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts
pnpm --filter @megasaver/cli exec vitest run test/hooks/intent-run.test.ts test/hooks/task-kickoff-store.test.ts test/bundle-smoke.test.ts -t 'cancels delayed Git in the single published bundle'
pnpm --filter @megasaver/cli typecheck
pnpm exec biome check apps/cli/src/cli.ts apps/cli/src/hooks/task-kickoff-deadline.ts apps/cli/src/hooks/intent-run.ts apps/cli/src/hooks/task-kickoff-process.ts apps/cli/src/hooks/task-kickoff.ts apps/cli/src/hooks/task-kickoff-store.ts apps/cli/test/hooks/intent-run.test.ts apps/cli/test/hooks/task-kickoff-store.test.ts apps/cli/test/bundle-smoke.test.ts packages/stats/src/task-kickoff-event.ts packages/stats/test/task-kickoff-event.test.ts
```

Then build the Node 22 bundle and run the exact CI cancellation selector with
`MEGASAVER_BUNDLE_CANCEL_REQUIRE_GIT_START=1`. Commit:

```text
fix(cli): close kickoff process boundaries
```

- [ ] **Step 5: Fresh review and final gate**

Request new independent code-reviewer and critic passes after this commit. Fix
every Critical or Important finding. Then run the exact Node 22 CI bundle
selector and clean-state `pnpm verify`, and update the cache-write wiki source,
log, channel, and changeset wording with the final evidence. Do not claim a
savings percentage without the paired benchmark.
