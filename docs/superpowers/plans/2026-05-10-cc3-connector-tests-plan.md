---
title: CC3 — Connector Test Coverage Batch (11 tests)
risk: MEDIUM
created: 2026-05-10
status: active
---

# CC3 — Connector Test Coverage Batch (11 tests)

Close 11 critic-flagged test-coverage gaps from PRs #15-#21 across
S/T/U-series. All additions build on CC2's connector/{sync,status,shared,index}.ts
split and CC5's X4 cap-by-recency + U7 mkdir-wrap.

## Step plan

### Step 1 — Create `apps/cli/test/connector/shared.test.ts`

Direct unit tests for `pickLatestOpenSession` exported from
`apps/cli/src/commands/connector/shared.ts`.

**T1** — 0 sessions, 1 open session, 1 ended + 1 open, 2 open with different
`startedAt` (latest wins), wrong agentId filtered out.

**T3** — Same-instant tie-break: two open sessions with identical `startedAt`
for same agentId. Documents "first in array wins" (Array.reduce left-to-right:
if timestamps are equal, `current` is NOT strictly greater, so `latest` is
returned — meaning index-0 session wins).

**T4** — DST-transition: session at 2026-03-13T01:30:00.000Z vs
2026-03-13T03:30:00.000Z. Assert numeric `Date.parse` (not lexicographic)
identifies the latter as more recent.

**T5** — Millisecond precision: two sessions differing by 1ms. Assert the
later one wins.

**S7** — 3 open sessions for same agentId, strictly increasing `startedAt`.
Assert last (most recent) is returned.

### Step 2 — Add S5 to `packages/connectors/shared/test/context.test.ts` or new file

**S5** — `readTargetFile` symlink behavior. Current behavior: `readTargetFile`
uses `readFile` (follows symlinks); it does NOT lstat-first. Document this
by asserting the function reads through a symlink pointing outside the project
root. Flag as security concern in test comment; the write path (`writeTargetFile`)
already guards with `lstat` + `isSymbolicLink()`.

### Step 3 — Add S11 to `apps/cli/test/connector.test.ts`

**S11** — `targets.length > 0` invariant after filter in `runConnectorStatus`.
When `--target X` is a valid known target id, `KNOWN_TARGETS.filter(t => t.id === X)`
returns exactly one entry. Test that each known target id resolves to exactly one
entry (no duplicates, no misses). Also test the pre-loop guard: invalid target is
caught by `resolveProjectAndRoot` before the filter runs.

### Step 4 — Add U2 to `apps/cli/test/connector-status.test.ts`

**U2** — Cursor-specific `no-block` test. Seed `.cursor/rules/megasaver.mdc`
with content but no sentinels. Run `connector status`. Assert output line:
`cursor  .cursor/rules/megasaver.mdc  no-block  session=...`.

### Step 5 — Add U3 to `apps/cli/test/connector.test.ts`

**U3** — Cursor sync into existing user-content `.mdc` file. Seed with
frontmatter + user prose + no sentinels. Run sync `--target cursor`. Assert
file ends with user content + `\n\n<!-- MEGA SAVER:BEGIN -->\n...\n<!-- MEGA SAVER:END -->\n`.
Managed block APPENDED, not replacing user content.

### Step 6 — Add U5 to `apps/cli/test/connector.test.ts`

**U5** — Cursor multi-open-session cross-leak. Both `claude-code` and `cursor`
sessions open. Run sync. Assert CLAUDE.md contains claude-code session id (not
cursor id), `.cursor/rules/megasaver.mdc` contains cursor session id (not
claude-code id).

### Step 7 — Add U6 to `apps/cli/test/connector.test.ts`

**U6** — `mkdir` failure path test (ENOSPC / ENOTDIR path collision). Test that
when the target directory cannot be created, the error is wrapped as
`file_write_failed` and emitted as a per-target error line (not top-level abort).
Partner to U7 (EACCES via chmod). For ENOTDIR: create a regular file at the
path where a directory is expected (e.g., `.cursor` as a file not a directory)
so `mkdir` gets ENOTDIR. Skip on root via `process.getuid()`.

### Step 8 — Commit batches

- Commit 1: `test: add pickLatestOpenSession unit tests (T1-T5 S7)` — new file
  `apps/cli/test/connector/shared.test.ts`
- Commit 2: `test: S5 symlink read-through behavior in connectors-shared` — if
  placed in connectors/shared test; otherwise bundled
- Commit 3: `test: close U2 U3 U5 U6 S11 connector coverage` — additions to
  existing test files

### Step 9 — Verify

Run `pnpm exec vitest run` directly (bypass turbo cache). All 11 new tests pass.
No existing tests broken.

## Placement decisions

| Item | File |
|------|------|
| T1, T3, T4, T5, S7 | `apps/cli/test/connector/shared.test.ts` (new) |
| S5 | `packages/connectors/shared/test/filesystem.test.ts` (or new file) |
| S11 | `apps/cli/test/connector-status.test.ts` |
| U2 | `apps/cli/test/connector-status.test.ts` |
| U3 | `apps/cli/test/connector.test.ts` |
| U5 | `apps/cli/test/connector.test.ts` |
| U6 | `apps/cli/test/connector.test.ts` |

## Pitfall avoidances

- Use word-boundary regex `\bvalue\b` for content checks (avoid substring false positives).
- No `vi.spyOn(fsp, "mkdir")` on frozen ESM — use real filesystem (chmod/ENOTDIR trick).
- No placeholder tests — every assertion covers real behavior.
- Run `pnpm exec vitest run` not `turbo test` (cache can mask failures).
