# Windows Seen-Ledger Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Windows from rejecting a seen-ledger write when an unrelated
host handle blocks file replacement.

**Architecture:** Readers and writers use the same lock path and existing timing
policy. While holding that lock, the writer directly replaces the small JSON
file's contents rather than renaming a temporary file over it. Lock contention
and write failure preserve the present fail-open result rather than retrying or
blocking a hook.

**Tech Stack:** TypeScript, Node filesystem APIs, Vitest, pnpm.

## Global Constraints

- Preserve the 50 ms deadline, 5-second stale interval, and fail-open result.
- Do not change the JSON schema or FIFO cap.
- Protect reads and writes with the same session lock path.
- Do not call `renameSync` for the seen-ledger write.

---

### Task 1: Avoid Windows target replacement under the seen-ledger lock

**Files:**
- Modify: `packages/context-gate/src/saver-seen.ts`
- Modify: `packages/context-gate/test/saver-seen.test.ts`

**Interfaces:**
- Consumes: `withFileLock(lockPath, { deadlineMs: 50, staleMs: 5000 }, fn)`.
- Produces: `recordSeenOutput(...)` uses direct `writeFileSync(path, bytes)`
  inside the existing writer lock and never propagates an auxiliary write
  failure.

- [ ] **Step 1: Add the failing target-replacement regression test**

Mock `node:fs.renameSync` to throw, dynamically import a fresh
`saver-seen.ts`, then record a hash and assert that it is still reported as
seen. The current writer must fail red because it calls `renameSync`.

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/saver-seen.test.ts`

Expected before the correction: FAIL with the injected replacement error.

- [ ] **Step 2: Write the ledger directly under the existing writer lock**

Replace temporary-file creation and `renameSync` with a direct
`writeFileSync(path, JSON.stringify({ version: 1, hashes: capped }))`. Catch a
write error inside the lock callback and return normally, because this ledger's
documented fail-open result is a redundant compression rather than a failed
tool hook.

- [ ] **Step 3: Verify the unit and process race contracts**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/saver-seen.test.ts test/saver-seen-concurrency.test.ts`

Expected: all seen-ledger unit tests and the four concurrently spawned writers
pass, including the injected replacement failure contract.
