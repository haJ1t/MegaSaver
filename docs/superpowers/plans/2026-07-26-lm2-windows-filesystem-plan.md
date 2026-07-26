# LM2 Windows filesystem compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LM2 durable-memory filesystem operations work on Windows without weakening POSIX security checks.

**Architecture:** `lm2-fs-platform.ts` owns platform-sensitive open flags and directory synchronization; `lm2-secure-fs.ts` re-exports them. Existing callers consume the shared helpers; their post-open identity checks, locking, and atomic publication behavior remain intact.

**Tech Stack:** Node 22 filesystem APIs, TypeScript, Vitest, fs-ext.

## Global Constraints

- Keep `O_NOFOLLOW` and `O_DIRECTORY` on non-Windows platforms.
- On Windows, use post-open `fstat`/`lstat` identity and symlink checks already present in LM2.
- Skip only directory metadata `fsync` on Windows; retain file `fsync`.
- No test exclusions or changed product receipts.

---

### Task 1: Test portable secure filesystem primitives

**Files:**
- Create: `packages/long-memory/src/lm2-fs-platform.ts`
- Create: `packages/long-memory/test/lm2-secure-fs.test.ts`
- Modify: `packages/long-memory/src/lm2-secure-fs.ts`

**Interfaces:**
- Produces `secureOpenFlags(flags, platform)` and `syncDirectoryAnchor(anchor, platform)` for all durable LM2 storage callers.

- [ ] **Step 1: Write failing tests**

Assert that Windows returns the supplied flags unchanged while Linux adds
`O_NOFOLLOW`, and that a Windows directory sync does not call `fsyncSync`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @megasaver/long-memory exec vitest run test/lm2-secure-fs.test.ts`

Expected: FAIL because the portable helpers do not exist.

- [ ] **Step 3: Implement the minimal helpers**

Use `process.platform` by default, allow a platform parameter only for the
unit contracts, and return before directory `fsync` on `win32`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @megasaver/long-memory exec vitest run test/lm2-secure-fs.test.ts`

Expected: PASS.

### Task 2: Route LM2 storage through the primitives

**Files:**
- Modify: `packages/long-memory/src/lm2-secure-fs.ts`
- Modify: `packages/long-memory/src/lm2-catalog-lock.ts`
- Modify: `packages/long-memory/src/lm2-benchmark-safe-path.ts`
- Modify: `packages/long-memory/src/lm2-secure-publish-files.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-validation.test.ts`

**Interfaces:**
- Consumes the helpers from Task 1.
- Produces unchanged LM2 lock, publication, and benchmark APIs.

- [ ] **Step 1: Replace raw platform-sensitive flags and directory fsync calls**

Apply `secureOpenFlags` to each `O_NOFOLLOW` open. Use a directory-specific
helper for `O_DIRECTORY`; use `syncDirectoryAnchor` for publication metadata
syncs.

- [ ] **Step 2: Make the path test use resolved path semantics**

Compare the expected vector root to `resolve(root)` before joining children,
matching production `vectorWorkspacePath` on Windows and POSIX.

- [ ] **Step 3: Run focused regressions**

Run: `pnpm --filter @megasaver/long-memory exec vitest run test/lm2-secure-fs.test.ts test/lm2-vector-store.test.ts test/lm2-vector-store-validation.test.ts test/lm2-catalog-security.test.ts test/lm2-benchmark-files-security.test.ts`

Expected: PASS.

### Task 3: Verify and release

**Files:**
- Modify: `wiki/agent-channel.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Run the complete quality gate**

Run: `pnpm verify`

Expected: exit 0.

- [ ] **Step 2: Obtain an independent review**

Request review from a fresh reviewer context; address findings before release.

- [ ] **Step 3: Commit and push the scoped repair**

Run: `git add ... && git commit -m "fix(long-memory): support Windows filesystem guards" && git push`

- [ ] **Step 4: Require replacement matrix evidence**

Confirm the PR's Ubuntu and Windows verify jobs and bundle-smoke steps pass
before merging.
