---
title: atomicWriteFile — don't fail a committed write on post-rename dir-fsync error
status: draft
risk: medium
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
---

# atomicWriteFile dir-fsync edge

## Problem

`atomicWriteFile` exists as two near-identical copies:
`packages/content-store/src/atomic-write.ts` and
`packages/agent-office/src/atomic-write.ts`. Both, on POSIX, perform a
parent-directory `fsync` **after** `renameSync` commits the file. If
that directory fsync throws, the `catch` block re-throws `write_failed`
even though the write already succeeded. A caller's retry logic would
then double-write, or treat a healthy store as broken.

The directory fsync is a *durability hint* (it makes the rename metadata
survive a kernel panic / power loss). It is not a correctness gate for
the data itself — once `renameSync` returns, the file is present with the
correct contents.

## Decision

- **Approach: Option 1** — fix both copies in place with a `renamed`
  flag. Keep the (intentional, already slightly-diverged) duplication.
- **Not Option 2** (hoist to `@megasaver/shared`): `@megasaver/shared`
  is deliberately browser-safe and is bundled by the GUI
  (`apps/gui/src/cockpit/panels/workspace-panels.tsx` imports
  `encodeWorkspaceKey`; `workspace-key.ts` explicitly avoids `node:crypto`
  for browser bundling). Putting `node:fs`/`node:crypto` code in shared's
  barrel would break the browser build. A safe hoist would need a
  node-only subpath export or a new package — disproportionate for one
  function.
- **Sequencing:** fold into the open Phase 0 PR (#161) on branch
  `worktree-feat+agent-office`, since `@megasaver/agent-office` exists
  only on that branch (not yet on `main`). The content-store copy lives
  on `main` and is fixed on the same branch.

## Change (identical logic in both copies; only the error class differs)

```
let renamed = false;
// ... write temp, fsync temp ...
renameSync(tempPath, filePath);
renamed = true;
// ... POSIX parent-dir fsync (may throw) ...
} catch (error) {
  if (!renamed) {
    try { rmSync(tempPath, { force: true }); } catch { /* ignore */ }
  }
  if (renamed) return;            // write committed; dir-fsync is a durability hint
  if (error instanceof <StoreError>) throw error;
  throw new <StoreError>("write_failed", "Store write failed.", { cause: error });
}
```

Preserve each file's existing comments and its own error class
(`ContentStoreError` vs `AgentOfficeError`).

## Behavior contract

- Pre-rename failure (temp write, temp fsync, symlink-parent guard,
  rename itself) → tmp cleaned up, `write_failed` thrown (unchanged).
- Post-rename failure (parent-dir fsync) → function returns normally;
  the file is committed with correct contents.

## Testing

Each package gets a regression test (`test/atomic-write-fsync-edge.test.ts`
or appended to the existing atomic-write test):

- `vi.mock("node:fs", ...)` wrapping the real module so that the **2nd**
  `fsyncSync` call (temp-file fsync is 1st, parent-dir fsync is 2nd on
  POSIX) throws.
- Assert `atomicWriteFile(path, content)` does **not** throw and the file
  exists with the expected content.
- Guard POSIX-only (skip on `process.platform === "win32"`, where there
  is no parent-dir fsync, hence no 2nd call).
- Keep the existing pre-rename failure tests green (symlink-parent
  rejection still throws `write_failed`).

## Definition of Done

- Both copies fixed with identical logic.
- New regression test per package, green; existing atomic-write tests
  still green.
- `pnpm verify` green (Biome + tsc + vitest + conventions:check).
- Changeset: patch for `@megasaver/content-store`; include
  `@megasaver/agent-office` for the record.
- Code-reviewer subagent pass (author ≠ reviewer).
