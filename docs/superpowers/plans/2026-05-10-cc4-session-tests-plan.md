---
title: CC4 Session/Memory Test Coverage Batch
risk: MEDIUM
branch: feat/cc4-session-tests
created: 2026-05-10
---

# CC4 — Session & Memory Test Coverage Plan

Closes 8 critic-flagged backlog items (V1-V8, W10) from PR #18 + PR #19.

## Steps

### Step 1 — V4: Whitespace-only title rejection in `update` (BEHAVIOR FIX)
- File: `apps/cli/src/commands/session/update.ts`
- Analysis: `update.ts` line 87 skips `titleSchema` when `titleFlag === ""` (clear-title sentinel).
  But `"   "` (whitespace-only) passes the `!== ""` guard, enters `titleSchema.parse()`, which
  `.trim()` reduces to `""`, then `.min(1)` rejects it — so it's already rejected via the
  `mapErrorToCliMessage(err, { kind: "title" })` path.
- Verify the existing path produces `error: title must not be empty` (same message as create).
- Add test: `update <id> --title "   "` → `error: title must not be empty`, exit 1.
- File: `apps/cli/test/session.test.ts` (existing `sessionUpdateCommand` describe block)

### Step 2 — W10: Restore NODE_ENV in `memory.test.ts` afterEach
- File: `apps/cli/test/memory.test.ts`
- `memoryCreateCommand` describe block sets `process.env.NODE_ENV = "test"` in `runCreate()`
  but never restores it in `afterEach`.
- Mirror the save/restore pattern from `sessionCreateCommand` in `session.test.ts`:
  capture original at describe scope, restore in `afterEach`.

### Step 3 — V8: Pin exact Zod error message format for `session_update`
- File: `apps/cli/test/session.test.ts`
- Current test for invalid session update Zod error uses `startsWith("error:")`.
- Replace with `toBe` against the exact `error: invalid session update: <path>: <msg>` string.
- Need to know which field/path the Zod error targets for session_update context.

### Step 4 — V6: Update-then-end durability test
- File: `apps/cli/test/session.test.ts` (existing `sessionUpdateCommand` describe block)
- Sequence: seed open session → `runUpdate({ risk: "high" })` → `runEnd(SESSION_ID)` →
  read sessions.json → assert `riskLevel: "high"` persists on ended session.
- Requires `sessionEndCommand` import in existing update test block.

### Step 5 — V7: Multi-flag error precedence pin test
- File: `apps/cli/test/session.test.ts` (existing `sessionUpdateCommand` describe block)
- Call `runUpdate({ sessionId: "<bad-uuid>", risk: "bogus", agent: "unknown" })`.
- The current code validates sessionId first (before any flags), so the session-id
  parse error surfaces first.
- Assert exact error message + exit 1.

### Step 6 — V2: Partial-write recovery test for `json-directory-store.ts`
- File: `packages/core/test/json-directory-store.test.ts` (new file)
- Mock `renameSync` (or `fs.renameSync`) to throw after `writeFileSync` to simulate
  a crash between temp-write and atomic rename in `atomicWriteFile`.
- Assert the original file content is preserved and the `.tmp` file is cleaned up.
- Use `vi.mock("node:fs", ...)` or spy on the named import.

### Step 7 — V3: Schema-drift property test using fast-check
- File: `packages/core/test/session-schema.property.test.ts` (new file)
- fast-check is already in `packages/core` devDependencies.
- Generate random valid sessions + random valid patches; assert merged result parses.
- Use `numRuns: 50`, bounded arbitraries.

### Step 8 — V1: Concurrent-update race test via process fork
- File: `apps/cli/test/session/update-concurrency.test.ts` (new file)
- Build CLI first: `pnpm --filter @megasaver/cli build`.
- Fork 2 child processes simultaneously calling `node dist/cli.js session update <id> --title A/B`.
- Assert both exit 0 (or one exits with error) and file is not corrupt.
- Lock is file-based (`.projects.lock`), so one wins and one gets a valid response.

## Verification
- `pnpm verify` from monorepo root must pass green.
- One commit per item; Conventional Commits prefix `test:` (or `fix:` for V4).
