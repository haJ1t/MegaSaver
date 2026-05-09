# Add --root Flag to `mega project create` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `--root <dir>` flag to `mega project create` so users can register a project pointing to any directory without changing their cwd.

**Architecture:** Add `rootFlag?: string` to `RunProjectCreateInput`, wire it through `runProjectCreate` using `path.resolve(input.rootFlag) ?? input.cwd` for `rootPath`, and expose it as a `--root` string arg in `projectCreateCommand`. No other files change.

**Tech Stack:** TypeScript strict ESM, Citty (CLI framework), Vitest (tests), Node `path.resolve`, Biome (lint/fmt), pnpm verify (DoD gate).

---

## File Map

| File | Change |
|---|---|
| `apps/cli/src/commands/project.ts` | Add `rootFlag?: string` to `RunProjectCreateInput`; add `path` import; replace `rootPath: input.cwd` with conditional resolve; add `root` arg to `projectCreateCommand` |
| `apps/cli/test/project.test.ts` | Add three test cases inside `describe("projectCreateCommand")` |

---

## Task 1: Failing test — `--root /abs/path` stores absolute rootPath

**Files:**
- Modify: `apps/cli/test/project.test.ts`

- [ ] **Step 1: Add the failing test**

Open `apps/cli/test/project.test.ts`. Inside `describe("projectCreateCommand", () => {`, after the last existing `it(...)` block (after the NFD/NFC test, around line 228), add:

```ts
it("stores rootPath from --root when an absolute path is given", async () => {
  await projectCreateCommand.run?.({
    args: { name: "demo", store: root, root: "/tmp/abs-root-test" },
    cmd: projectCreateCommand,
    rawArgs: ["demo", "--store", root, "--root", "/tmp/abs-root-test"],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  const persisted = JSON.parse(
    await readFile(join(root, "projects.json"), "utf8"),
  ) as Array<{ rootPath: string }>;
  expect(persisted[0]?.rootPath).toBe("/tmp/abs-root-test");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | tail -30
```

Expected: test fails — either type error (unknown `root` arg) or the stored `rootPath` is `process.cwd()` instead of `"/tmp/abs-root-test"`. The point is RED.

---

## Task 2: Implement the `--root` flag

**Files:**
- Modify: `apps/cli/src/commands/project.ts`

- [ ] **Step 1: Add `node:path` import**

At the top of `apps/cli/src/commands/project.ts`, after the existing `import { randomUUID } from "node:crypto";` line, add:

```ts
import { resolve } from "node:path";
```

- [ ] **Step 2: Add `rootFlag` to `RunProjectCreateInput`**

Locate the `RunProjectCreateInput` type (around line 87). Add the optional field after `xdgDataHome`:

```ts
export type RunProjectCreateInput = {
  name: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  rootFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};
```

- [ ] **Step 3: Replace `rootPath: input.cwd` with conditional resolve**

In `runProjectCreate`, locate the `registry.createProject(...)` call (around line 138). Change:

```ts
rootPath: input.cwd,
```

to:

```ts
rootPath: input.rootFlag !== undefined ? resolve(input.rootFlag) : input.cwd,
```

- [ ] **Step 4: Add `root` arg to `projectCreateCommand`**

Locate `projectCreateCommand` args definition (around line 156). Add `root` after `store`:

```ts
args: {
  name: {
    type: "positional",
    required: true,
    description: "Project name (non-empty after trim).",
  },
  store: { type: "string", description: "Override store directory." },
  root: {
    type: "string",
    description: "Project root directory (absolute or relative; defaults to current directory).",
  },
},
```

- [ ] **Step 5: Wire `rootFlag` in the `run` handler**

In the `run({ args })` handler of `projectCreateCommand`, add `rootFlag` to the `runProjectCreate` call:

```ts
async run({ args }) {
  const code = await runProjectCreate({
    name: typeof args.name === "string" ? args.name : "",
    storeFlag: typeof args.store === "string" ? args.store : undefined,
    rootFlag: typeof args.root === "string" ? args.root : undefined,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
    home: process.env["HOME"] ?? "",
    // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access for process.env
    xdgDataHome: process.env["XDG_DATA_HOME"],
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });
  if (code !== 0) process.exitCode = code;
},
```

- [ ] **Step 6: Run the failing test again to confirm it passes**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | tail -30
```

Expected: the new test PASSES. All prior tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
git add apps/cli/src/commands/project.ts apps/cli/test/project.test.ts
git commit -m "feat(cli): add --root flag to project create"
```

---

## Task 3: Test — relative `--root .` resolves to absolute path

**Files:**
- Modify: `apps/cli/test/project.test.ts`

- [ ] **Step 1: Add the relative-path test**

Inside `describe("projectCreateCommand", () => {`, after the test added in Task 1, add:

```ts
it("resolves a relative --root to an absolute path", async () => {
  await projectCreateCommand.run?.({
    args: { name: "demo", store: root, root: "." },
    cmd: projectCreateCommand,
    rawArgs: ["demo", "--store", root, "--root", "."],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  const persisted = JSON.parse(
    await readFile(join(root, "projects.json"), "utf8"),
  ) as Array<{ rootPath: string }>;
  // path.resolve(".") returns an absolute path; it must not equal "."
  expect(persisted[0]?.rootPath).toBe(resolve("."));
  expect(persisted[0]?.rootPath.startsWith("/")).toBe(true);
});
```

Note: `resolve` must be imported at the top of the test file — add this import if not already present:

```ts
import { join, resolve } from "node:path";
```

(The existing import is `import { join } from "node:path";` — extend it to include `resolve`.)

- [ ] **Step 2: Run tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | tail -30
```

Expected: new test PASSES (impl already handles relative paths via `path.resolve`). All prior tests still pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
git add apps/cli/test/project.test.ts
git commit -m "test(cli): add relative --root resolve test"
```

---

## Task 4: Regression test — omitting `--root` keeps `process.cwd()` behavior

**Files:**
- Modify: `apps/cli/test/project.test.ts`

- [ ] **Step 1: Add the regression test**

Inside `describe("projectCreateCommand", () => {`, after the relative-path test, add:

```ts
it("stores process.cwd() as rootPath when --root is omitted (regression)", async () => {
  await projectCreateCommand.run?.({
    args: { name: "demo", store: root },
    cmd: projectCreateCommand,
    rawArgs: ["demo", "--store", root],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  const persisted = JSON.parse(
    await readFile(join(root, "projects.json"), "utf8"),
  ) as Array<{ rootPath: string }>;
  expect(persisted[0]?.rootPath).toBe(process.cwd());
});
```

- [ ] **Step 2: Run the full test suite**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | tail -40
```

Expected: ALL tests pass including the regression test.

- [ ] **Step 3: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
git add apps/cli/test/project.test.ts
git commit -m "test(cli): add regression test for omitted --root"
```

---

## Task 5: DoD gate — `pnpm verify` green

**Files:** none (verification only)

- [ ] **Step 1: Run full verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm verify 2>&1 | tail -50
```

Expected: lint PASS, typecheck PASS, test PASS. No errors.

If lint fails with a Biome formatting issue, run:

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm lint:fix
git add apps/cli/src/commands/project.ts apps/cli/test/project.test.ts
git commit -m "chore: biome format fix"
```

Then re-run `pnpm verify`.

---

## Task 6: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Build the CLI**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
pnpm build 2>&1 | tail -20
```

Expected: build succeeds, `apps/cli/dist/cli.js` is present.

- [ ] **Step 2: Run smoke test from `/tmp`**

```bash
STORE=$(mktemp -d -t store-XXXX)
ROOT=$(mktemp -d -t root-XXXX)
node /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag/apps/cli/dist/cli.js project create demo --root "$ROOT" --store "$STORE"
node /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag/apps/cli/dist/cli.js project list --store "$STORE"
```

Expected output from `project list`: a line like `<uuid>  demo`, and when you inspect `$STORE/projects.json` the `rootPath` field equals `$ROOT` (not `/tmp` or cwd).

- [ ] **Step 3: Inspect persisted rootPath**

```bash
cat "$STORE/projects.json"
```

Expected: `"rootPath"` equals the value of `$ROOT`.

---

## Task 7: Push and open PR

- [ ] **Step 1: Push branch**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-flag
git push -u origin feat/project-root-flag
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --title "feat(cli): add --root flag to project create" \
  --body "$(cat <<'EOF'
## Summary

- Adds optional `--root <dir>` flag to `mega project create`
- When provided, `rootPath = path.resolve(args.root)` (handles both absolute and relative inputs)
- When omitted, `rootPath = process.cwd()` — byte-identical to previous behavior
- No existence check at create time (Option B: trust downstream `assertProjectRoot`)

## Behavior contract

| Invocation | rootPath stored |
|---|---|
| `mega project create demo` | `process.cwd()` |
| `mega project create demo --root /abs/path` | `"/abs/path"` |
| `mega project create demo --root ./rel` | `path.resolve("./rel")` |
| `mega project create demo --root /nonexistent` | stored as-is, no error |

## Test plan

- [x] `--root /abs/path` stores correct absolute rootPath
- [x] `--root .` resolves relative path to absolute
- [x] omitting `--root` keeps `process.cwd()` (regression)
- [x] `pnpm verify` green (lint + typecheck + test)
- [x] Manual smoke: invoked from `/tmp`, `--root $ROOT`, `project list` confirms rootPath = $ROOT

## Smoke evidence

```
$ STORE=$(mktemp -d -t store-XXXX)
$ ROOT=$(mktemp -d -t root-XXXX)
$ node apps/cli/dist/cli.js project create demo --root "$ROOT" --store "$STORE"
<uuid>  demo
$ cat "$STORE/projects.json" | grep rootPath
  "rootPath": "<value of $ROOT>",
```
EOF
)"
```

- [ ] **Step 3: Send PR URL to team-lead**

After `gh pr create` outputs the PR URL, send it to team-lead via SendMessage.
EOF
