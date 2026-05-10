---
title: DD2 BB hardening — implementation plan
status: in-progress
created: 2026-05-10
updated: 2026-05-10
related:
  - docs/superpowers/specs/2026-05-10-dd2-bb-hardening-design.md
---

# DD2 — BB hardening implementation plan

## Step 0 — Worktree

`git worktree add .worktrees/dd2-bb-hardening -b feat/dd2-bb-hardening origin/main`. Done.

## Step 1 — Item 1: fsync durability

### 1a — TDD red

Edit `packages/core/test/json-directory-store.test.ts`. Add a
third test in the existing `describe("atomicWriteFile —
partial-write recovery (V2)")` block:

```ts
it("calls fsync on the temp file fd before rename", async () => {
  // mock openSync + fsyncSync, assert fsync called
  //   exactly once on the fd returned by openSync(tempPath, ...)
  //   BEFORE renameSync is called
});
```

The test mocks `openSync`, `fsyncSync`, `closeSync`,
`renameSync` from `node:fs`, runs `writeSessions`, and asserts
the call order.

This test fails today (no fsync calls).

### 1b — Implementation

Edit `packages/core/src/json-directory-store.ts`:

```ts
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

// ...

// Durability: writeFileSync returns once bytes are in the kernel
// page cache. Without fsync, a crash before the cache flushes
// can lose data even after rename. POSIX best practice (Linux
// fsync(2), sqlite §6.7): fsync the temp file BEFORE rename so
// the data is durable; fsync the parent dir AFTER rename so the
// rename's directory metadata flushes.
function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new CorePersistenceError("store_write_failed", "Store write failed.", {
        filePath: parentDir,
      });
    }

    mkdirSync(parentDir, { recursive: true });

    writeFileSync(tempPath, content);
    const tempFd = openSync(tempPath, "r");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }

    renameSync(tempPath, filePath);

    // Flush the parent directory so the rename survives a crash.
    // On macOS/Linux this is required; on Windows fsync(dirFd)
    // may throw EISDIR/EPERM — swallow since data fsync above
    // already covers the durability contract for Mega Saver.
    let dirFd: number | undefined;
    try {
      dirFd = openSync(parentDir, "r");
      fsyncSync(dirFd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EISDIR" && code !== "EPERM" && code !== "ENOTSUP") {
        throw error;
      }
    } finally {
      if (dirFd !== undefined) {
        try {
          closeSync(dirFd);
        } catch {}
      }
    }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; callers need the original write failure.
    }

    throw new CorePersistenceError("store_write_failed", "Store write failed.", {
      filePath,
      cause: error,
    });
  }
}
```

### 1c — TDD green

Re-run the V2 test. Assert all three sub-tests pass.

### 1d — Commit

`feat: fsync durability in atomicWriteFile`

## Step 2 — Item 2: cross-process lock test

### 2a — TDD red (will require build first)

Build the CLI first:

```bash
pnpm --filter @megasaver/cli build
```

Then create
`packages/core/test/json-directory-store.cross-process.test.ts`:

- `spawn` 5 child `mega session update <id> --title T<n>
  --store <root>` processes via `child_process.spawn`.
- `await Promise.all` for them to exit.
- Assert serialisation invariants (see spec §2).

### 2b — Implementation

No production code change beyond Step 1 — the lock
infrastructure already exists. The test just exercises the
existing `withDirLock` across processes.

### 2c — TDD green

Run the new test. If it flakes, lengthen lock timeout? No —
flake means a real bug. Investigate.

### 2d — Commit

`test: cross-process lock integration test`

## Step 3 — Item 3: S10 stanza

### 3a — Edit spec

Append `## §11 Concurrency: status vs concurrent sync` to
`docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`
between current §10 (out of scope) and EOF — actually insert
BEFORE §10 since concurrency is part of the design contract,
not out of scope.

Actually re-reading: §10 is "Out of scope (explicit)". The
proper home for §11 is between the existing §9 Risk and §10 Out
of scope. We renumber: insert new §10 = concurrency, demote old
§10 → §11.

### 3b — Commit

`docs: S10 concurrency stanza in status spec`

## Step 4 — Verify

`pnpm exec vitest run` (bypasses turbo cache). Capture full
output for PR body.

## Step 5 — Flake assessment

Run cross-process test 5 times in a loop:

```bash
for i in 1 2 3 4 5; do
  pnpm exec vitest run --root packages/core \
    -t "cross-process lock integration"
done
```

Report pass/fail count.

## Step 6 — PR

Title: `feat: BB hardening — fsync durability + cross-process
lock test (DD2)`. Body per task brief.

## Per-item commit boundaries

1. Spec + plan (this commit, since they go together).
2. fsync durability (`feat:`).
3. Cross-process lock test (`test:`).
4. S10 concurrency stanza (`docs:`).

Total: 4 commits.
