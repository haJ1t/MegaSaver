# Windows Seen-Ledger Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Windows from rejecting seen-ledger atomic replacement while another saver hook reads it.

**Architecture:** Readers and writers use the same lock path and existing timing policy. Lock contention keeps the present fail-open read result rather than retrying or blocking a hook.

**Tech Stack:** TypeScript, Node filesystem APIs, Vitest, pnpm.

## Global Constraints

- Preserve the 50 ms deadline, 5-second stale interval, and fail-open result.
- Do not change the JSON schema or FIFO cap.
- Protect reads and writes with the same session lock path.

---

### Task 1: Lock seen-ledger reads

**Files:**
- Modify: `packages/context-gate/src/saver-seen.ts`
- Modify: `packages/context-gate/test/saver-seen.test.ts`

**Interfaces:**
- Consumes: `withFileLock(lockPath, { deadlineMs: 50, staleMs: 5000 }, fn)`.
- Produces: `hasSeenOutput(...) === false` whenever the seen-ledger lock is
  contended.

- [ ] **Step 1: Add the failing fail-open contention test**

Record a hash, create its fresh `.json.lock`, and assert `hasSeenOutput` is
`false`.

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/saver-seen.test.ts`

Expected before the correction: FAIL because the reader bypasses the lock and
returns `true`.

- [ ] **Step 2: Use one lock policy for readers and writers**

Add `SEEN_LOCK_OPTIONS = { deadlineMs: 50, staleMs: 5000 }`. Read into a local
`seen = false` only inside `withFileLock`; return that default if acquisition
fails. Return `false` before lock acquisition when the ledger file does not
exist, because the lock helper requires its parent directory to exist. Reuse
the same constant in `recordSeenOutput`.

- [ ] **Step 3: Verify the unit and process race contracts**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/saver-seen.test.ts test/saver-seen-concurrency.test.ts`

Expected: 6 tests pass, including four concurrently spawned writers.
