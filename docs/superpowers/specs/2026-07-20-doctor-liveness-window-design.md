# Doctor Saver-Liveness Window — Design

- **Date:** 2026-07-20
- **Risk:** MEDIUM (health-check logic in `mega doctor`; no user-data mutation,
  no compression path. It gates CI via `bundle-smoke`, so a wrong fix turns
  `pnpm verify` red for everyone.)
- **Status:** user-approved design (approach A, scoping via a dedicated liveness
  window, locked 2026-07-20).

## Problem (measured)

`mega doctor`'s `saver-liveness` check fails permanently and never self-heals.
On this machine:

```
saver-liveness invocations not completing (crash/timeout signal,
                workspace 5fe7a040a2e5a5b8) FAIL
9 PASS / 1 FAIL
```

From `~/.local/share/megasaver/stats/saver-hook-heartbeats.json`:

| | |
|---|---:|
| `workspaces` (last invocation per key) | 67 |
| `completions` (last completion per key) | 30 |
| keys with an invocation and **no** completion | **37** |
| invocation timestamp of the reported key | `2026-07-14T10:25:17.264Z` |

The reported workspace is a dead temp/worktree directory from six days prior.
The current session's workspace records completions normally, so the completion
path itself works.

Because `apps/cli/test/bundle-smoke.test.ts` asserts `mega doctor` exits 0,
this also makes `pnpm verify` red on `main`.

## Root cause

Two different windows are conflated.

`packages/context-gate/src/saver-heartbeat.ts` prunes the ledger with
`TTL_MS = 30 * 86_400_000` — a **stats retention** window. `computeView`
applies it to `workspaces`, `completions`, `failures`, and `daemonFallbacks`
alike.

`apps/cli/src/commands/doctor-saver.ts` then scans every surviving entry and
takes the first with a gap:

```ts
const gap = Object.entries(view.workspaces)
  .map(([wk, invIso]) => ({ wk, inv: Date.parse(invIso), comp: ... }))
  .find(({ inv, comp }) => comp === null || inv - comp > LIVENESS_GAP_GRACE_MS);
```

`LIVENESS_GAP_GRACE_MS` (5 min) bounds the invocation-vs-completion **delta**,
never how recent the invocation is. So `comp === null` matches forever, and the
check fails from the moment a workspace dies mid-invocation until it ages past
30 days.

The code states the false premise explicitly:

> `computeView already prunes stale invocations, so any survivor here is recent
> enough that a missing completion is real.`

A 30-day retention window does not make a survivor recent. Any workspace that
ever invoked the saver without completing — a test fixture, a killed process,
an isolated-store integration test, a deleted worktree — poisons the check.

Neither suggested remedy works: re-running `mega doctor` leaves the stale key,
and `mega hooks install` does not clear historical records.

**The same defect exists in the sibling branch.** The `failures` filter scans
the same 30-day-retained map, so a week-old failure with no later completion in
that workspace sticks identically. A fix that covers only the gap scan leaves
half the bug.

## Goal

`saver-liveness` answers a "right now" question: did the hook fire and fail to
finish, recently, in a workspace that is still relevant? Historical wreckage
must not fail it. A genuine current crash/timeout must still fail it.

## Design

Introduce a dedicated liveness recency window, separate from stats retention.

- Add `LIVENESS_WINDOW_MS = 24 * 60 * 60 * 1000` in `doctor-saver.ts`, beside
  the existing `LIVENESS_GAP_GRACE_MS`, with a comment stating why it is not
  `TTL_MS`.
- Filter **both** scans to workspaces whose last invocation is within
  `now - LIVENESS_WINDOW_MS`:
  - the invocation-vs-completion gap scan,
  - the `failures` scan.
- Retention is untouched: `TTL_MS` stays 30 days so stats, `hooks status`, and
  `proxy saver-telemetry` keep their history. Only doctor's liveness verdict
  narrows.
- Correct the stale comment that asserts pruning implies recency.

24 hours is chosen so a crash stays visible across a normal working break while
week-old wreckage does not. The window is a named constant, adjustable without
touching logic.

### Accepted trade-off

A crash that is not inspected within 24 hours goes quiet. This is acceptable and
consistent with the check's own remediation hint ("run `mega doctor` after the
next tool call") — the signal is meant to be acted on immediately, and the
failure ledger still records it for the stats surfaces.

## What this deliberately does not do

- Does not prune or rewrite the user's ledger. The 37 stale keys stay; they are
  simply no longer consulted for liveness. Mutating a user's stats store to make
  a check pass would be papering over the defect.
- Does not narrow the check to the current workspace. This repo routinely runs
  several worktrees at once, and a crashed hook in a sibling active worktree is
  exactly what the check exists to surface.

## Testing

Behaviour-level, against `buildSaverDoctorChecks` with an injected `now`:

1. **Regression (the reported bug):** a workspace with an invocation older than
   the window and no completion → `saver-liveness` **passes**.
2. **Signal preserved:** a workspace with an invocation inside the window and no
   completion → **fails**, naming that workspace.
3. **Gap variant preserved:** invocation inside the window, completion older
   than the invocation by more than `LIVENESS_GAP_GRACE_MS` → **fails**.
4. **Failures branch, both directions:** a failure older than the window with no
   later completion → passes; a failure inside the window with no later
   completion → fails.
5. **Boundary:** an invocation exactly at the window edge is treated
   deterministically (assert the chosen side explicitly rather than leaving it
   to floating comparison).
6. **Mixed ledger:** stale gap entries plus one recent healthy workspace →
   passes, proving stale entries are ignored rather than merely outranked.

Existing `apps/cli/test/doctor-saver.test.ts` cases must keep passing; any whose
fixtures rely on undated or far-past timestamps get explicit timestamps inside
the window, since they were implicitly depending on the unbounded scan.

## Definition of done

`pnpm verify` green — including `bundle-smoke`, which is the CI symptom that
motivated this. `mega doctor` on this machine reports `10 PASS / 0 FAIL`
without any modification to the user's heartbeat ledger. Code-reviewer pass.
Changeset for `@megasaver/cli`.
