# CC5 — Defensive Code + Policy Decisions Plan

**Date:** 2026-05-10
**Branch:** feat/cc5-defensive-policy
**Risk:** MEDIUM
**Items:** 8 (U7, U9, W4, W5, W6, W9, X4, X5)

## Pre-decided policies (USER LOCKED)

- **W4:** `mega memory create --scope session <project> --session <ended-uuid>` → REJECT with
  `session_already_ended` error code. Mirror `session update` pattern.
- **X4:** Drop `.max(20)` hard-fail on `ConnectorContextSchema.memoryEntries`. In
  `buildConnectorContext` (connector.ts), sort entries by `createdAt` descending and slice to 20.
  Older entries remain in store, accessible via `mega memory list`.

---

## Step-by-step implementation

### U7 — Wrap mkdir failures as `file_write_failed`

**Files:**
- `apps/cli/src/commands/connector.ts` — `mkdir` call at line ~147

**Steps:**
1. Wrap the `mkdir({ recursive: true })` call in `runConnectorSync` in a try/catch.
2. On catch, throw `ConnectorError("file_write_failed", ..., { cause })`.
3. The outer per-target catch already maps `ConnectorError` to CLI output via `mapErrorToCliMessage`.
4. Add test: mock `fs.mkdir` to throw `EACCES`; assert `error` status line + `file_write_failed`
   message in stderr.

### U9 — Validate `ConnectorTarget.header` at module load

**Files:**
- `packages/connectors/generic-cli/src/targets.ts`

**Steps:**
1. After `builtinTargets` is defined, iterate and check that no `header` contains
   `MEGA_SAVER_BLOCK_START` or `MEGA_SAVER_BLOCK_END`.
2. Import constants from `@megasaver/connectors-shared`.
3. Throw `Error` at module load if violated (module-load guard, not runtime).
4. Add test in `packages/connectors/generic-cli/test/targets.test.ts` asserting that a target
   with a sentinel in its header throws at construction/validation time.

### W4 — Reject memory create on ended sessions

**Files:**
- `apps/cli/src/commands/memory/create.ts`
- `apps/cli/src/errors.ts` (add `session_already_ended` mapper for `memory_create` kind)
- `apps/cli/test/memory.test.ts` (new tests)

**Steps:**
1. After the session lookup succeeds (line ~111), check `session.endedAt !== null`.
2. If ended, call `sessionAlreadyEndedMessage(session.id, session.endedAt)` and return 1.
3. Confirm `mapErrorToCliMessage` already handles `session_already_ended` code (it does via the
   `session` / `session_update` branch — but `memory_create` context kind needs a branch or reuse).
4. Actually: the direct `session.endedAt` check in the handler is cleaner; no new error code path.
5. Add tests: ended session → exit 1 + `error: session "..." already ended at ...`.

### W5 — `memory_entry_already_exists` mapper branch

**Files:**
- `apps/cli/src/errors.ts`
- `apps/cli/test/errors.test.ts`

**Steps:**
1. In `mapErrorToCliMessage`, in the `CoreRegistryError` block, add branch for
   `err.code === "memory_entry_already_exists"`.
2. Return `{ message: "error: memory entry already exists", exitCode: 1 }`.
3. Add test importing mapper directly and asserting the message.

### W6 — Block U+2028 / U+2029 in contentSchema and titleSchema

**Files:**
- `apps/cli/src/commands/memory/shared.ts` — `contentSchema`
- `apps/cli/src/commands/session/shared.ts` — `titleSchema`
- `apps/cli/test/memory.test.ts` (new rejection tests)
- `apps/cli/test/session.test.ts` (new rejection tests)

**Steps:**
1. Extend the `contentSchema` regex from `^[^\x00-\x1f\x7f-\x9f]+$` to also block ` ` and
   ` `: `^[^\x00-\x1f\x7f-\x9f  ]+$`.
2. Same extension on `titleSchema` regex in `session/shared.ts`.
3. Add tests asserting both U+2028 and U+2029 are rejected in both schemas.

### W9 — Document parse-on-handoff policy

**Files:**
- `docs/conventions/code-conventions.md`
- `apps/cli/src/commands/memory/create.ts` (one-line trust-boundary comment)
- `apps/cli/src/commands/session/create.ts` (one-line trust-boundary comment)

**Steps:**
1. Append a "Parse-on-handoff policy" section to `code-conventions.md`:
   CLI commands re-parse user input at the handoff boundary if and only if a later consumer
   (renderer, file writer) would crash on bad input; trust the registry once data has crossed
   the schema boundary inside Core.
2. Add a one-line comment at the `memoryEntrySchema.parse(...)` call in `memory/create.ts`.
3. Add a one-line comment at the session schema usage in `session/create.ts`.

### X4 — Filter-then-cap-by-recency for `memoryEntries`

**Files:**
- `packages/connectors/shared/src/context.ts` — remove `.max(20)`
- `apps/cli/src/commands/connector.ts` — cap in `buildConnectorContext`
- Tests in `apps/cli/test/connector.test.ts` (25-entry project → 20 most recent)

**Steps:**
1. In `ConnectorContextSchema`, change `z.array(memoryEntrySchema).max(20)` to
   `z.array(memoryEntrySchema)`.
2. In `buildConnectorContext`, after `filterMemoryEntriesForSession`, sort by `createdAt`
   descending and slice to 20.
3. Add the required comment.
4. Update any existing tests that relied on `.max(20)` hard-fail → rework to recency semantics.
5. Add new test: 25 entries → block contains 20 most recent in descending order.

### X5 — Dead continuation-indent path in render.ts

**Investigation:**
- `render.ts:32-37`: splits `entry.content` on `\n` and indents continuation lines.
- `contentSchema` blocks `\x00-\x1f` which covers `\n` (0x0A).
- Path through `renderBlock` → `assertConnectorContext` → schema parse validates content.
- Therefore, `continuationLines` is always `[]` and `renderedContinuation` is always `""`.
- The branch `if (renderedContinuation.length === 0)` always takes the single-line path.
- The multi-line branch is unreachable via the public surface.

**Decision:** Document the invariant inline (one comment) + simplify the dead code per instructions.
Actually, task says "delete the branch OR document the invariant with a comment if reachable through
some other path." Since not reachable, delete the dead path.

**Steps:**
1. Confirm no other path reaches `renderMemoryEntries` with multi-line content (grep done above).
2. Simplify `renderMemoryEntries` to single-line-only format.
3. No test changes required (existing tests don't exercise the deleted branch).

---

## Verification

- `pnpm verify` must be green (lint + typecheck + test) before PR.
- Test counts expected: +8 to +12 new tests across packages.
