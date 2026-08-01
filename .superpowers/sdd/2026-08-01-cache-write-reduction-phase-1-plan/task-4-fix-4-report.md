# Task 4 GC safety follow-up

Base: `4ecee173` on `fix/cli-task-kickoff-hardening`.

## No-follow task-pack sweep

`pruneTaskKickoffFiles` now accepts only ordinary directories at each path
component it walks: `stats`, its workspace entry, and `task-pack`. It accepts
only ordinary files at the deletion point, using `lstatSync` rather than
following symlinks with `statSync`. A symlinked workspace, task-pack directory,
or eligible-looking entry is skipped, so the task-pack sweep cannot use a
symlink to unlink a file outside the store. This protection applies equally to
old `.json` packs and `.json.claim` sidecars.

## Kickoff-only retention cadence

GC now uses ordinary existing `content/` and/or `stats/` directories for its
daily marker. Existing content stores retain the historical `content/.last-gc`
marker; kickoff-only stores use `stats/.last-gc`, allowing the same 30-day
claim retention without creating saver content or re-running expensive sweeps
on every prompt. A store with neither directory remains a no-op.

The 30-day cutoff remains retention housekeeping. It is never used by the hook
to reclaim or steal a live kickoff claim.

## Test evidence

RED regressions before the fix:

1. A symlinked `stats/<workspace>` caused the task-pack GC to remove an old
   external claim victim.
2. A fresh stats-only store returned false before sweeping a 31-day claim.

Green tests cover the external victim and symlink entry remaining intact, the
31-day claim being swept from a no-content store, fresh claim preservation, a
stats marker being written, and a second call being throttled.

Verification:

```text
pnpm --filter @megasaver/cli exec vitest run test/hooks/gc.test.ts test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-hardening.test.ts
# 3 files passed, 28 tests passed
pnpm --filter @megasaver/cli typecheck
pnpm exec biome check apps/cli/src/hooks/gc.ts apps/cli/test/hooks/gc.test.ts
git diff --check
```
