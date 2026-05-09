# project create --root test gap coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 tests to `apps/cli/test/project.test.ts` that pin existing `--root` edge-case behavior introduced in PR #26.

**Architecture:** Test-only change. All 3 tests go inside the existing `describe("projectCreateCommand")` block. Each test calls `projectCreateCommand.run?.()` directly (same pattern as existing `--root` tests) and reads `projects.json` to assert `rootPath`.

**Tech Stack:** Vitest, Node `path.join` + `path.resolve` (already imported), `node:fs/promises` (already imported).

---

## File Map

| File | Change |
|---|---|
| `apps/cli/test/project.test.ts` | Add 3 test cases after line 268 (after existing `--root` tests) |

---

## Task 1: Add test for `--root foo/bar` (relative with subdirectory)

**Files:**
- Modify: `apps/cli/test/project.test.ts`

- [ ] **Step 1: Add the test after the existing `--root` regression test (after line 268)**

Inside `describe("projectCreateCommand", () => {`, after the "stores process.cwd() as rootPath when --root is omitted" test, add:

```ts
it("resolves --root foo/bar (relative with subdir) to absolute path", async () => {
  await projectCreateCommand.run?.({
    args: { name: "demo", store: root, root: "foo/bar" },
    cmd: projectCreateCommand,
    rawArgs: ["demo", "--store", root, "--root", "foo/bar"],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
    rootPath: string;
  }>;
  expect(persisted[0]?.rootPath).toBe(join(process.cwd(), "foo/bar"));
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-test-gaps
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "foo/bar|PASS|FAIL|Tests " | head -10
```

Expected: test PASSES (current impl uses `path.resolve("foo/bar")` which equals `join(cwd, "foo/bar")`).

---

## Task 2: Add test for `--root /nonexistent` (non-existent path stored as-is)

**Files:**
- Modify: `apps/cli/test/project.test.ts`

- [ ] **Step 1: Add the test after Task 1's test**

```ts
it("stores --root /nonexistent as-is without error (Option B: no fs check)", async () => {
  await projectCreateCommand.run?.({
    args: { name: "demo", store: root, root: "/nonexistent-path-gap4" },
    cmd: projectCreateCommand,
    rawArgs: ["demo", "--store", root, "--root", "/nonexistent-path-gap4"],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  expect(logSpy).toHaveBeenCalledTimes(1);
  const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
    rootPath: string;
  }>;
  expect(persisted[0]?.rootPath).toBe("/nonexistent-path-gap4");
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-test-gaps
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "nonexistent|PASS|FAIL|Tests " | head -10
```

Expected: test PASSES.

---

## Task 3: Add test for `--root ""` (empty string → cwd)

**Files:**
- Modify: `apps/cli/test/project.test.ts`

- [ ] **Step 1: Add the test after Task 2's test**

```ts
it("treats --root '' (empty string) as process.cwd() via path.resolve semantics", async () => {
  await projectCreateCommand.run?.({
    args: { name: "demo", store: root, root: "" },
    cmd: projectCreateCommand,
    rawArgs: ["demo", "--store", root, "--root", ""],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  const persisted = JSON.parse(await readFile(join(root, "projects.json"), "utf8")) as Array<{
    rootPath: string;
  }>;
  expect(persisted[0]?.rootPath).toBe(process.cwd());
});
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-test-gaps
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "Test Files|Tests " | head -5
```

Expected: all tests pass.

---

## Task 4: Commit + DoD gate

- [ ] **Step 1: Commit the tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-test-gaps
git add apps/cli/test/project.test.ts
git commit -m "test(cli): pin --root edge-case coverage (gaps 1/2/4)"
```

- [ ] **Step 2: Run pnpm verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-test-gaps
pnpm verify 2>&1 | grep -E "Tasks:|error|passed|failed" | tail -10
```

Expected: all tasks successful, no errors.

- [ ] **Step 3: Push and open PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/project-root-test-gaps
git push -u origin feat/project-root-test-gaps
gh pr create \
  --title "test(cli): project create --root test gap coverage" \
  --body "..."
```
