---
title: Plan — stop abandoning a successful stale-lock steal
spec: docs/superpowers/specs/2026-07-25-stale-lock-steal-abandoned-design.md
risk: HIGH
created: 2026-07-25
---

# Plan — stale-lock steal abandoned

## Task 1 — RED (done)

`packages/shared/test/file-lock.test.ts`: a stale lock with
`deadlineMs: 0` must still be stolen and run `fn`. Fails before the fix
with `expected false to be true`.

## Task 2 — GREEN (done)

`packages/shared/src/file-lock.ts`: track `stolen`; a successful steal
retries the acquire past the deadline, bounded by `MAX_STEALS = 2`. The
failed-steal path keeps its deadline bail so the EPERM/EISDIR spin
guard holds.

## Task 3 — prove nothing regressed

- Existing spin guard (directory at lock path) still returns false
  without hanging.
- Fresh-lock contention still skips (no double-run).
- Run the two originally-failing context-gate suites.

## Task 4 — docs + release

`.changeset/stale-lock-steal.md` (patch, @megasaver/shared);
`wiki/log.md`. Record that the CI-green claim is NOT made (spec §4).

## Task 5 — review + verify

`critic`, fresh context, working-tree git commands forbidden, snapshot
first. `pnpm verify` after the review, not concurrently.
