---
title: Plan — remove unread `ownerDead` / `leasePhase`
spec: docs/superpowers/specs/2026-07-25-reconcile-obs-dead-fields-design.md
risk: HIGH
created: 2026-07-25
---

# Plan — unread reconcile observations

## Task 1 — RED: key-set guard

`packages/proxy-control/test/supervisor.test.ts`

Assert `Object.keys(observeReality(deps, control)).sort()` equals
exactly `["confirmed","generationLive","hasLease","health","route"]`.

Fails today (7 keys). Runtime assertion, not `expectTypeOf` — this
package's vitest config has no `typecheck` block, so a `.test-d.ts`
would not run at all.

**Verify:** `pnpm --filter @megasaver/proxy-control test` red on that
test only; every recovery-matrix test still green.

## Task 2 — GREEN: delete the fields

- `src/reconcile.ts` — drop `leasePhase` and `ownerDead` from
  `ReconcileObs`; add a WHY comment recording that owner liveness is
  decided at the lock layer (`isOwnerStale`), not here.
- `src/supervisor.ts` — drop both computations from `observeReality`.

**Verify:** package tests + `pnpm typecheck` (catches any consumer).

## Task 3 — test fixture + misleading name

`packages/proxy-control/test/reconcile.test.ts`

- Remove both fields from the `base` observation.
- Rename the `:45` test: the decision turns on `desiredEnabled`, not on
  a dead owner.

**Verify:** package tests green, count unchanged apart from the new
guard.

## Task 4 — docs + release

- `.changeset/reconcile-obs-dead-fields.md` — major,
  `@megasaver/proxy-control`.
- `wiki/concepts/persistent-proxy-routing.md` — record where owner
  liveness actually lives, and that `handoffDeadline` is a sentinel
  because the bootstrap handoff is unimplemented.
- `wiki/log.md` entry.

**Verify:** `pnpm verify`.

## Task 5 — review (HIGH, §12)

`critic`, fresh context. Explicitly forbid working-tree git commands
(a previous reviewer's `git checkout` revert destroyed uncommitted
work); snapshot the files first and diff against the snapshot at the
end.

**Verify:** `pnpm verify` captured after the review, not concurrently.
