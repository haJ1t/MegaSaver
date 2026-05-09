# `--json` Output for `memory list` + `memory show` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional `--json` boolean flag to `mega memory list` and `mega memory show`, emitting compact JSON while preserving byte-identical default behavior.

**Architecture:** Add `jsonFlag: boolean` to each command's input type. In `runMemoryList`, branch on `jsonFlag` to collect all entries and emit `JSON.stringify(entries)` (or `"[]"`) instead of per-line `formatMemoryListLine`. In `runMemoryShow`, branch to emit `JSON.stringify(entry)` instead of `formatMemoryShowLines`. Citty arg type is `"boolean"`. No new helpers needed.

**Tech Stack:** TypeScript strict ESM, Citty boolean args, Vitest, Biome.

---

## File Map

| File | Change |
|---|---|
| `apps/cli/src/commands/memory/list.ts` | Add `jsonFlag: boolean` to `RunMemoryListInput`; branch in `runMemoryList`; add `json` boolean arg + wire in `run` |
| `apps/cli/src/commands/memory/show.ts` | Add `jsonFlag: boolean` to `RunMemoryShowInput`; branch in `runMemoryShow`; add `json` boolean arg + wire in `run` |
| `apps/cli/test/memory.test.ts` | Add tests to `memoryListCommand` and `memoryShowCommand` describe blocks |

---

## Task 1: Failing tests for `memory list --json`

**Files:**
- Modify: `apps/cli/test/memory.test.ts`

- [ ] **Step 1: Add two failing tests inside `describe("memoryListCommand")`**

The existing `describe("memoryListCommand")` block has a `seed()` helper and a `runList()` helper. Add these two tests after the last existing test in that describe block (after the last `it(...)` before the closing `}`):

```ts
it("emits JSON array of entries with full content when --json is set", async () => {
  await seed();
  await memoryListCommand.run?.({
    args: { projectName: "demo", store, json: true },
    cmd: memoryListCommand,
    rawArgs: ["demo", "--store", store, "--json"],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  expect(logSpy).toHaveBeenCalledTimes(1);
  const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Array<{
    id: string;
    projectId: string;
    scope: string;
    sessionId: string | null;
    content: string;
    createdAt: string;
  }>;
  expect(parsed).toHaveLength(2);
  expect(parsed[0]?.id).toBe(MEMORY_ID_PROJECT);
  expect(parsed[0]?.scope).toBe("project");
  expect(parsed[0]?.sessionId).toBeNull();
  expect(parsed[0]?.content).toBe("user prefers TS");
  expect(parsed[1]?.id).toBe(MEMORY_ID_SESSION);
  expect(parsed[1]?.sessionId).toBe(SESSION_ID);
});

it("emits [] for empty project when --json is set", async () => {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS }]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  await mkdir(join(store, "memory"), { recursive: true });

  await memoryListCommand.run?.({
    args: { projectName: "demo", store, json: true },
    cmd: memoryListCommand,
    rawArgs: ["demo", "--store", store, "--json"],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  expect(logSpy).toHaveBeenCalledTimes(1);
  expect(logSpy.mock.calls[0]?.[0]).toBe("[]");
});
```

- [ ] **Step 2: Run tests — expect RED on the new tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "memoryList|✓|×|Test Files|Tests " | head -20
```

Expected: 2 new tests FAIL (type error on `json` arg or wrong output shape).

---

## Task 2: Implement `--json` in `memory list`

**Files:**
- Modify: `apps/cli/src/commands/memory/list.ts`

- [ ] **Step 1: Add `jsonFlag` to `RunMemoryListInput`**

Locate the `RunMemoryListInput` type. Add `jsonFlag: boolean` after `xdgDataHome`:

```ts
export type RunMemoryListInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
```

- [ ] **Step 2: Branch in `runMemoryList`**

Locate the `for (const entry of registry.listMemoryEntries(project.id))` loop. Replace it with:

```ts
const entries = registry.listMemoryEntries(project.id);
if (input.jsonFlag) {
  input.stdout(JSON.stringify(entries));
} else {
  for (const entry of entries) {
    input.stdout(formatMemoryListLine(entry));
  }
}
```

- [ ] **Step 3: Add `json` boolean arg + wire in `memoryListCommand`**

Locate `memoryListCommand`'s `args` definition. Add after `store`:

```ts
json: {
  type: "boolean",
  description: "Emit JSON instead of formatted text.",
},
```

In the `run({ args })` handler, add `jsonFlag`:

```ts
const code = await runMemoryList({
  projectName: typeof args.projectName === "string" ? args.projectName : "",
  storeFlag: typeof args.store === "string" ? args.store : undefined,
  jsonFlag: args.json === true,
  cwd: process.cwd(),
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  home: process.env["HOME"] ?? "",
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  xdgDataHome: process.env["XDG_DATA_HOME"],
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
```

- [ ] **Step 4: Run tests — expect GREEN on the 2 new list tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "memoryList|✓|×" | head -15
```

Expected: all `memoryListCommand` tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
git add apps/cli/src/commands/memory/list.ts apps/cli/test/memory.test.ts
git commit -m "feat(cli): add --json to memory list"
```

---

## Task 3: Failing test for `memory show --json`

**Files:**
- Modify: `apps/cli/test/memory.test.ts`

- [ ] **Step 1: Add failing test inside `describe("memoryShowCommand")`**

The existing `describe("memoryShowCommand")` block has a `seed()` helper and `runShow()` helper. Add this test after the last existing test in that block:

```ts
it("emits compact JSON object when --json is set", async () => {
  await seed();
  await memoryShowCommand.run?.({
    args: { memoryEntryId: MEMORY_ID_PROJECT, store, json: true },
    cmd: memoryShowCommand,
    rawArgs: [MEMORY_ID_PROJECT, "--store", store, "--json"],
    data: undefined,
  } as never);

  expect(process.exitCode).toBe(0);
  expect(logSpy).toHaveBeenCalledTimes(1);
  const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
    id: string;
    projectId: string;
    scope: string;
    sessionId: string | null;
    content: string;
    createdAt: string;
  };
  expect(parsed.id).toBe(MEMORY_ID_PROJECT);
  expect(parsed.projectId).toBe(PROJECT_ID);
  expect(parsed.scope).toBe("project");
  expect(parsed.sessionId).toBeNull();
  expect(parsed.content).toBe("user prefers TS");
  expect(parsed.createdAt).toBe(TS);
});
```

- [ ] **Step 2: Run tests — expect RED on the new test**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "memoryShow|✓|×" | head -15
```

Expected: the new show JSON test FAILS.

---

## Task 4: Implement `--json` in `memory show`

**Files:**
- Modify: `apps/cli/src/commands/memory/show.ts`

- [ ] **Step 1: Add `jsonFlag` to `RunMemoryShowInput`**

```ts
export type RunMemoryShowInput = {
  memoryEntryId: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
```

- [ ] **Step 2: Branch in `runMemoryShow`**

Locate `for (const line of formatMemoryShowLines(entry)) input.stdout(line);`. Replace with:

```ts
if (input.jsonFlag) {
  input.stdout(JSON.stringify(entry));
} else {
  for (const line of formatMemoryShowLines(entry)) input.stdout(line);
}
```

- [ ] **Step 3: Add `json` boolean arg + wire in `memoryShowCommand`**

In `memoryShowCommand`'s `args`, add after `store`:

```ts
json: {
  type: "boolean",
  description: "Emit JSON instead of formatted text.",
},
```

In the `run({ args })` handler, add `jsonFlag`:

```ts
const code = await runMemoryShow({
  memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
  storeFlag: typeof args.store === "string" ? args.store : undefined,
  jsonFlag: args.json === true,
  cwd: process.cwd(),
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  home: process.env["HOME"] ?? "",
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  xdgDataHome: process.env["XDG_DATA_HOME"],
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
```

- [ ] **Step 4: Run all tests — expect GREEN**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -E "Test Files|Tests " | head -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
git add apps/cli/src/commands/memory/show.ts apps/cli/test/memory.test.ts
git commit -m "feat(cli): add --json to memory show"
```

---

## Task 5: DoD gate — `pnpm verify` GREEN

- [ ] **Step 1: Run lint fix + verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
pnpm lint:fix && pnpm verify 2>&1 | grep -E "Tasks:|error|passed|failed" | tail -10
```

Expected: 12/12 tasks, all tests pass, no errors.

If lint fix applied changes, commit them:

```bash
git add apps/cli/src/commands/memory/list.ts apps/cli/src/commands/memory/show.ts apps/cli/test/memory.test.ts
git commit -m "chore: biome format fix"
```

---

## Task 6: Push + PR

- [ ] **Step 1: Push**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-memory
git push -u origin feat/json-memory
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --title "feat(cli): --json output for memory list + show" \
  --body "..."
```

Include behavior contract, test plan, smoke evidence in PR body.

- [ ] **Step 3: SendMessage team-lead with PR URL**
