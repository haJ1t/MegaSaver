# LM2 Windows filesystem compatibility design

**Risk:** HIGH — durable memory lock and evidence storage paths.

## Problem

Windows CI run `30211016909` fails every LM2 path that opens an anchored
directory or file. The shared secure filesystem layer unconditionally passes
the POSIX-only `O_NOFOLLOW` and `O_DIRECTORY` flags; failures become
fail-closed `index_lock_unavailable` / `store_corrupt` receipts. The same
run also exposes a POSIX-only `/store` expected pathname in one test.

## Decision

Keep POSIX flags on POSIX. On Windows, omit only unsupported open flags and
continue to reject unexpected filesystem objects with the existing immediate
`fstat`/`lstat` identity checks, repeated anchor checks, and explicit symlink
checks. Directory metadata `fsync` is skipped on Windows, where Node cannot
reliably sync a directory descriptor; file `fsync`, `LockFileEx` via
`fs-ext`, no-clobber publication, and all validation remain unchanged.

The compatibility helpers belong in the focused `lm2-fs-platform.ts` module,
with `lm2-secure-fs.ts` re-exporting them so catalog, vector, and benchmark
storage share exactly one platform decision without breaching source limits.

## Scope

- Add tested helpers for secure open flags and directory synchronization.
- Route secure filesystem, catalog lock, benchmark path/files, and publish
  code through those helpers.
- Make the vector-path expectation platform-neutral.
- Preserve all POSIX security behavior and fail closed for every failed
  identity check.

## Acceptance evidence

1. New helper contracts distinguish Windows from POSIX flags.
2. Focused LM2 storage and benchmark tests pass locally.
3. `pnpm verify` passes locally.
4. Independent reviewer approves the final diff.
5. Replacement Ubuntu and Windows CI jobs both complete successfully.
