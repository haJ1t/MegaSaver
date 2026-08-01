# Task 4 GC marker and stats-only P0 follow-up

Base: `9e2b2375` on `fix/cli-task-kickoff-hardening`.

## Marker safety

GC markers are now stamped by exclusively creating an owner-only regular temp
file in an ordinary marker directory, setting its timestamp, then atomically
renaming it onto `.last-gc`. Rename replaces a destination symlink itself; it
does not open or write through that symlink. The foreign target therefore stays
byte-identical, while a valid marker is installed inside the store.

## Stats-only scope

When there is no ordinary `content/` directory, the daily stats marker runs
only the hardened task-pack retention sweep. It does not call the content
pruner, intent/seen sweeps, evidence sweep, or summary reconciliation, because
those legacy paths do not all have task-pack's no-follow guarantees. Stores
with ordinary `content/` preserve the prior complete GC behavior.

## Test evidence

RED regressions before the fix:

1. A `.last-gc` symlink caused marker stamping to truncate its external target.
2. A stats-only workspace symlink let the legacy intent sweep delete an external
   old JSON file.

Green coverage confirms the marker target's bytes remain unchanged and the
marker becomes an ordinary file, while a stats-only GC leaves the external
legacy target untouched and does not invoke the content pruner. Existing
task-pack old/fresh retention and daily-throttle tests remain green.

Verification:

```text
pnpm --filter @megasaver/cli exec vitest run test/hooks/gc.test.ts test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-hardening.test.ts
# 3 files passed, 30 tests passed
pnpm --filter @megasaver/cli typecheck
pnpm exec biome check apps/cli/src/hooks/gc.ts apps/cli/test/hooks/gc.test.ts
git diff --check
pnpm verify
```
