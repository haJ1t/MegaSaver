# Task 4 GC marker TOCTOU follow-up

Base: `ec60f7e6` on `fix/cli-task-kickoff-hardening`.

## Canonical marker and revalidation

The daily marker is now canonical at `<store>/.last-gc`, rather than inside the
replaceable `content/` or `stats/` directories. Existing ordinary child markers
are read only for migration-compatible cadence; they are never written.

Marker stamping exclusively creates an owner-only empty temp file in the store
root, records both the root-directory and temp-file device/inode identities,
then revalidates both after creation and again after timestamping before the
atomic rename. If either identity changes, it returns false without timestamping
or renaming through the replacement path. Final cleanup removes the temp only
when the original directory and the exact ordinary temp file are still present.
The rename replaces a marker symlink itself and does not write through it.

## Test boundaries

The deterministic `afterMarkerTemporaryCreated` GC dependency seam replaces the
store root with a symlink between temp creation and revalidation. The hook
returns false and the replacement directory remains empty. This covers the
otherwise timing-sensitive branch without making the test scheduler-dependent.

Tests that create symlinks use the repository's Windows skip pattern because
Windows link creation may require unavailable privileges; the full coverage runs
on POSIX hosts.

## Verification

```text
pnpm --filter @megasaver/cli exec vitest run test/hooks/gc.test.ts test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-hardening.test.ts
# 3 files passed, 31 tests passed
pnpm --filter @megasaver/cli typecheck
pnpm exec biome check apps/cli/src/hooks/gc.ts apps/cli/test/hooks/gc.test.ts
git diff --check
pnpm verify
```
