# atomicWriteFile dir-fsync edge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `atomicWriteFile` treat a post-rename parent-directory fsync failure as success (the data is already committed), in both copies, with a regression test each.

**Architecture:** Add a `renamed` boolean to both copies (`packages/content-store/src/atomic-write.ts` and `packages/agent-office/src/atomic-write.ts`). Set it true right after `renameSync`. In `catch`, if `renamed` is true, return normally (skip tmp cleanup + skip re-throw); otherwise behave exactly as before. Logic identical across copies; only the error class differs. Keep the (intentional) duplication — Option 1 from the spec.

**Tech Stack:** TypeScript strict ESM, Vitest (`vi.mock`), Node `node:fs`.

**Spec:** [docs/superpowers/specs/2026-06-22-atomic-write-fsync-edge-design.md](../specs/2026-06-22-atomic-write-fsync-edge-design.md).

**Why not hoist to shared:** `@megasaver/shared` is browser-safe and bundled by the GUI; `node:fs`/`node:crypto` must not enter its barrel. See spec.

**Conventions for the implementer:**
- Run from repo root. Per-package test: `pnpm --filter @megasaver/<pkg> test`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.
- The regression test goes in a NEW file per package (`test/atomic-write-fsync-edge.test.ts`) so `vi.mock("node:fs")` is scoped to it and does not disturb the existing atomic-write tests.
- The test discriminates the directory fsync via `fstatSync(fd).isDirectory()` (robust; not call-count based) and is POSIX-only (win32 has no parent-dir fsync).
- Keep each file's existing comments and its own error class.

---

## File Structure

```
packages/content-store/src/atomic-write.ts        # modify: add renamed flag
packages/agent-office/src/atomic-write.ts          # modify: add renamed flag (identical logic)
packages/content-store/test/atomic-write-fsync-edge.test.ts   # new regression test
packages/agent-office/test/atomic-write-fsync-edge.test.ts    # new regression test
.changeset/atomic-write-fsync-edge.md              # new changeset
```

---

## Task 1: content-store — committed write survives dir-fsync failure

**Files:**
- Create: `packages/content-store/test/atomic-write-fsync-edge.test.ts`
- Modify: `packages/content-store/src/atomic-write.ts`

- [ ] **Step 1: Write the failing test**

`packages/content-store/test/atomic-write-fsync-edge.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Make ONLY the parent-directory fsync fail (identified by the fd being a
// directory), leaving every other fs call real. Scoped to this file.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      if (actual.fstatSync(fd).isDirectory()) {
        throw Object.assign(new Error("injected dir fsync failure"), { code: "EIO" });
      }
      return actual.fsyncSync(fd);
    },
  };
});

const { atomicWriteFile } = await import("../src/atomic-write.js");

const itPosix = process.platform === "win32" ? it.skip : it;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "content-store-fsync-edge-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("atomicWriteFile — post-rename dir-fsync failure", () => {
  itPosix("reports success when the parent-dir fsync fails after rename", () => {
    const path = join(root, "committed.json");
    expect(() => atomicWriteFile(path, "payload\n")).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe("payload\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/content-store test atomic-write-fsync-edge`
Expected: FAIL — current code re-throws `write_failed` (ContentStoreError) after the injected dir-fsync error, so `not.toThrow()` fails.

- [ ] **Step 3: Implement the fix**

In `packages/content-store/src/atomic-write.ts`:

1. Add the flag at the start of the `try` (right after the `tempPath` is computed, before the symlink guard). The current function starts:

```ts
export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
```

Change the `try {` opening to declare the flag first:

```ts
  let renamed = false;
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
```

2. Set it true immediately after the rename. Current:

```ts
    renameSync(tempPath, filePath);
    // POSIX directory fsync: required on ext4/xfs/APFS so the rename
```

becomes:

```ts
    renameSync(tempPath, filePath);
    renamed = true;
    // POSIX directory fsync: required on ext4/xfs/APFS so the rename
```

3. Short-circuit the catch when the write already committed. Current catch:

```ts
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; callers need the original write failure.
    }

    if (error instanceof ContentStoreError) throw error;
    throw new ContentStoreError("write_failed", "Store write failed.", { cause: error });
  }
```

becomes:

```ts
  } catch (error) {
    // After a successful rename the file is committed; the parent-dir fsync is
    // a durability hint, not a correctness gate. Don't fail (or clean up) a
    // write that already landed.
    if (renamed) return;

    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; callers need the original write failure.
    }

    if (error instanceof ContentStoreError) throw error;
    throw new ContentStoreError("write_failed", "Store write failed.", { cause: error });
  }
```

- [ ] **Step 4: Run the new test + the existing atomic-write tests**

Run: `pnpm --filter @megasaver/content-store test atomic-write`
Expected: PASS — the new fsync-edge test passes AND `atomic-write-behavior.test.ts` (symlink-parent rejection, create-parent-dirs, overwrite) still passes.

- [ ] **Step 5: Run the whole content-store suite**

Run: `pnpm --filter @megasaver/content-store test`
Expected: all green, 0 type errors.

- [ ] **Step 6: Biome**

Run: `pnpm exec biome check packages/content-store/src/atomic-write.ts packages/content-store/test/atomic-write-fsync-edge.test.ts`
Expected: clean (no fixes). If it reports formatting, run `pnpm exec biome check --write <same paths>` and re-stage.

- [ ] **Step 7: Commit**

```bash
git add packages/content-store/src/atomic-write.ts packages/content-store/test/atomic-write-fsync-edge.test.ts
git commit -m "fix(content-store): don't fail a committed write on dir-fsync error

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: agent-office — committed write survives dir-fsync failure

**Files:**
- Create: `packages/agent-office/test/atomic-write-fsync-edge.test.ts`
- Modify: `packages/agent-office/src/atomic-write.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-office/test/atomic-write-fsync-edge.test.ts` (identical to Task 1's test except the import path is the same `../src/atomic-write.js` and the temp prefix differs):

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      if (actual.fstatSync(fd).isDirectory()) {
        throw Object.assign(new Error("injected dir fsync failure"), { code: "EIO" });
      }
      return actual.fsyncSync(fd);
    },
  };
});

const { atomicWriteFile } = await import("../src/atomic-write.js");

const itPosix = process.platform === "win32" ? it.skip : it;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-office-fsync-edge-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("atomicWriteFile — post-rename dir-fsync failure", () => {
  itPosix("reports success when the parent-dir fsync fails after rename", () => {
    const path = join(root, "committed.json");
    expect(() => atomicWriteFile(path, "payload\n")).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe("payload\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test atomic-write-fsync-edge`
Expected: FAIL — current code re-throws `write_failed` (AgentOfficeError).

- [ ] **Step 3: Implement the fix**

In `packages/agent-office/src/atomic-write.ts` (same three edits as Task 1, but with `AgentOfficeError` and this file's existing comments):

1. Declare the flag. The function starts:

```ts
export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
```

becomes:

```ts
export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  let renamed = false;
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
```

2. Set it true after the rename. Current:

```ts
    renameSync(tempPath, filePath);
    // Windows does not support fsync on directory handles; the rename is durable via NTFS journaling.
    if (!IS_WIN32) {
```

becomes:

```ts
    renameSync(tempPath, filePath);
    renamed = true;
    // Windows does not support fsync on directory handles; the rename is durable via NTFS journaling.
    if (!IS_WIN32) {
```

3. Short-circuit the catch. Current:

```ts
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; surface the original write error.
    }
    if (error instanceof AgentOfficeError) throw error;
    throw new AgentOfficeError("write_failed", "Store write failed.", { cause: error });
  }
```

becomes:

```ts
  } catch (error) {
    // After a successful rename the file is committed; the parent-dir fsync is
    // a durability hint, not a correctness gate. Don't fail (or clean up) a
    // write that already landed.
    if (renamed) return;

    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; surface the original write error.
    }
    if (error instanceof AgentOfficeError) throw error;
    throw new AgentOfficeError("write_failed", "Store write failed.", { cause: error });
  }
```

- [ ] **Step 4: Run the new test + the existing atomic-write tests**

Run: `pnpm --filter @megasaver/agent-office test atomic-write`
Expected: PASS — new fsync-edge test passes AND `atomic-write.test.ts` (symlink-parent rejection, create-parent-dirs, overwrite) still passes.

- [ ] **Step 5: Run the whole agent-office suite**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: all green (was 57; now 58), 0 type errors.

- [ ] **Step 6: Biome**

Run: `pnpm exec biome check packages/agent-office/src/atomic-write.ts packages/agent-office/test/atomic-write-fsync-edge.test.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-office/src/atomic-write.ts packages/agent-office/test/atomic-write-fsync-edge.test.ts
git commit -m "fix(agent-office): don't fail a committed write on dir-fsync error

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Changeset + full verify

**Files:**
- Create: `.changeset/atomic-write-fsync-edge.md`

- [ ] **Step 1: Write the changeset**

`.changeset/atomic-write-fsync-edge.md`:

```md
---
"@megasaver/content-store": patch
"@megasaver/agent-office": patch
---

atomicWriteFile no longer reports a failure when the post-rename
parent-directory fsync throws. Once the rename commits, the file is
written; the directory fsync is a durability hint, not a correctness
gate. Prevents spurious write_failed errors that could trigger
double-writes in caller retry logic.
```

- [ ] **Step 2: Run the full DoD gate**

Run: `pnpm verify`
Expected: Biome clean, `tsc -b --noEmit` clean, all Vitest suites pass (content-store + agent-office include the two new edge tests), conventions:check ok. If Biome flags formatting anywhere, run `pnpm lint:fix` and re-stage.

- [ ] **Step 3: Commit**

```bash
git add .changeset/atomic-write-fsync-edge.md
git commit -m "chore(changeset): atomic-write dir-fsync edge fix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done

- [ ] Both `atomic-write.ts` copies have the identical `renamed`-flag logic.
- [ ] Each package has a passing POSIX-only regression test; existing atomic-write tests still pass.
- [ ] `pnpm verify` green.
- [ ] Changeset added (patch × 2).
- [ ] Code-reviewer subagent pass (author ≠ reviewer).

## Self-Review (plan author)

- **Spec coverage:** Option 1 both-copies fix → Tasks 1+2; identical logic + preserved comments/error class → Step 3 of each; regression test (vi.mock dir-fsync, POSIX-only, assert success) → Step 1 of each; pre-rename failures unchanged → verified by re-running existing atomic-write tests in Step 4; changeset → Task 3; pnpm verify → Task 3 Step 2.
- **Placeholder scan:** none — all code blocks complete.
- **Consistency:** `renamed` flag name, `if (renamed) return;` placement, and the `fstatSync(fd).isDirectory()` discriminator are identical across Tasks 1 and 2; only error class (`ContentStoreError` vs `AgentOfficeError`) and the existing comment lines differ, matching the two files' current contents.
